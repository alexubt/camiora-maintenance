import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// We need to set up mocks BEFORE importing auth.js because it imports state.js at module level.
// Use dynamic import after setting up the environment.

// Mock sessionStorage
const store = {};
const mockSessionStorage = {
  getItem: (key) => store[key] ?? null,
  setItem: (key, value) => { store[key] = String(value); },
  removeItem: (key) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};
globalThis.sessionStorage = mockSessionStorage;

// Node v24+ has crypto as a read-only global — no need to mock it.
// crypto.subtle and crypto.getRandomValues are available natively.

// Mock state
const mockState = { token: null, tokenExp: 0 };

// We'll import the module dynamically to capture exports
let auth;

before(async () => {
  // Patch globalThis.window to avoid errors in browser-targeted code
  if (!globalThis.window) globalThis.window = globalThis;
  auth = await import('./auth.js');
});

describe('SCOPES', () => {
  it('includes offline_access', () => {
    assert.ok(auth.SCOPES.includes('offline_access'), 'SCOPES must include offline_access');
  });
});

describe('saveToken', () => {
  beforeEach(() => mockSessionStorage.clear());

  it('stores refresh_token in sessionStorage when given full tokenData object', () => {
    auth.saveToken({
      access_token: 'at-123',
      expires_in: 3600,
      refresh_token: 'rt-456',
    });
    assert.equal(mockSessionStorage.getItem('ms_refresh_token'), 'rt-456');
    assert.equal(mockSessionStorage.getItem('ms_token'), 'at-123');
  });

  it('handles string argument for backward compatibility', () => {
    auth.saveToken('legacy-token', 3600);
    assert.equal(mockSessionStorage.getItem('ms_token'), 'legacy-token');
    // No refresh token stored for legacy calls
    assert.equal(mockSessionStorage.getItem('ms_refresh_token'), null);
  });
});

describe('signOut', () => {
  beforeEach(() => {
    mockSessionStorage.setItem('ms_refresh_token', 'rt-xxx');
    mockSessionStorage.setItem('ms_token', 'at-xxx');
  });

  it('clears ms_refresh_token from sessionStorage', () => {
    auth.signOut();
    assert.equal(mockSessionStorage.getItem('ms_refresh_token'), null);
  });
});

describe('getValidToken', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    mockSessionStorage.clear();
    globalThis.fetch = originalFetch;
  });

  it('returns current token when expiry is >5 min away', async () => {
    // Set up: token valid for 30 minutes
    auth.saveToken({
      access_token: 'valid-token',
      expires_in: 1800,
      refresh_token: 'rt-good',
    });

    const token = await auth.getValidToken();
    assert.equal(token, 'valid-token');
  });

  it('calls refreshAccessToken when expiry is <5 min away', async () => {
    // Set up: token that will expire in 2 minutes
    auth.saveToken({
      access_token: 'expiring-token',
      expires_in: 120,  // 2 minutes -- within the 5-min refresh window
      refresh_token: 'rt-refresh',
    });

    // Mock fetch for the refresh call
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-token',
        expires_in: 3600,
        refresh_token: 'rt-rotated',
      }),
    });

    const token = await auth.getValidToken();
    assert.equal(token, 'new-token');
  });

  it('returns null when no token exists', async () => {
    // Clear everything
    mockSessionStorage.clear();
    auth.saveToken({ access_token: '', expires_in: 0 });
    // Force state to have no token
    const { state } = await import('../state.js');
    state.token = null;
    state.tokenExp = 0;

    const token = await auth.getValidToken();
    assert.equal(token, null);
  });
});

describe('refreshAccessToken', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    mockSessionStorage.clear();
    globalThis.fetch = originalFetch;
  });

  it('POSTs grant_type=refresh_token to token endpoint and calls saveToken', async () => {
    mockSessionStorage.setItem('ms_refresh_token', 'rt-existing');

    let capturedBody = null;
    globalThis.fetch = async (url, opts) => {
      capturedBody = opts.body.toString();
      return {
        ok: true,
        json: async () => ({
          access_token: 'refreshed-at',
          expires_in: 3600,
          refresh_token: 'rt-new',
        }),
      };
    };

    const result = await auth.refreshAccessToken();
    assert.equal(result, true);
    assert.ok(capturedBody.includes('grant_type=refresh_token'));
    assert.equal(mockSessionStorage.getItem('ms_token'), 'refreshed-at');
    assert.equal(mockSessionStorage.getItem('ms_refresh_token'), 'rt-new');
  });

  it('returns false when no ms_refresh_token in sessionStorage', async () => {
    mockSessionStorage.clear();
    const result = await auth.refreshAccessToken();
    assert.equal(result, false);
  });
});
