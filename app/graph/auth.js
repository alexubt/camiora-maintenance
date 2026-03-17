/**
 * PKCE auth functions extracted from app.js.
 * Native ES module.
 */

import { state } from '../state.js';

// ── CONFIG ─────────────────────────────────────────────────────────────────────
export const CONFIG = {
  CLIENT_ID:     'd8a6756d-ed3c-4337-8146-bacf2f80ba37',
  TENANT_ID:     'common',
  REDIRECT_URI:  'https://alexubt.github.io/camiora-maintenance/',
  ONEDRIVE_BASE: 'Fleet Maintenance',
};

export const SCOPES = 'Files.ReadWrite User.Read offline_access';
export const GRAPH  = 'https://graph.microsoft.com/v1.0';

// ── Auth helpers ───────────────────────────────────────────────────────────────
function generateRandomString(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

async function generatePKCE() {
  const verifier = generateRandomString(64);
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

// ── Exported auth functions ────────────────────────────────────────────────────
export async function startLogin() {
  const { verifier, challenge } = await generatePKCE();
  sessionStorage.setItem('pkce_verifier', verifier);

  const p = new URLSearchParams({
    client_id:             CONFIG.CLIENT_ID,
    response_type:         'code',
    redirect_uri:          CONFIG.REDIRECT_URI,
    scope:                 SCOPES,
    response_mode:         'query',
    prompt:                'select_account',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
  window.location.href = `https://login.microsoftonline.com/${CONFIG.TENANT_ID}/oauth2/v2.0/authorize?${p}`;
}

export async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  if (!verifier) return null;

  const body = new URLSearchParams({
    client_id:     CONFIG.CLIENT_ID,
    grant_type:    'authorization_code',
    code:          code,
    redirect_uri:  CONFIG.REDIRECT_URI,
    code_verifier: verifier,
    scope:         SCOPES,
  });

  const resp = await fetch(
    `https://login.microsoftonline.com/${CONFIG.TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
  );

  if (!resp.ok) {
    console.error('Token exchange failed', await resp.text());
    return null;
  }

  const data = await resp.json();
  sessionStorage.removeItem('pkce_verifier');
  return data;
}

/**
 * Save token data. Accepts either:
 * - Full tokenData object: { access_token, expires_in, refresh_token }
 * - Legacy string: (token, expiresIn) for backward compat
 */
export function saveToken(tokenData, expiresIn) {
  if (typeof tokenData === 'object' && tokenData !== null) {
    const token = tokenData.access_token;
    const exp = Date.now() + (tokenData.expires_in || 3600) * 1000;
    sessionStorage.setItem('ms_token', token);
    sessionStorage.setItem('ms_token_exp', exp);
    state.token = token;
    state.tokenExp = exp;
    // Store rotating refresh token in sessionStorage only (not in state)
    if (tokenData.refresh_token) {
      sessionStorage.setItem('ms_refresh_token', tokenData.refresh_token);
    }
  } else {
    // Legacy: saveToken(tokenString, expiresIn)
    sessionStorage.setItem('ms_token', tokenData);
    sessionStorage.setItem('ms_token_exp', Date.now() + (expiresIn || 3600) * 1000);
    state.token = tokenData;
    state.tokenExp = Date.now() + (expiresIn || 3600) * 1000;
  }
}

export function loadToken() {
  const token = sessionStorage.getItem('ms_token');
  const exp   = parseInt(sessionStorage.getItem('ms_token_exp') || '0');
  if (token && Date.now() < exp) {
    state.token = token;
    state.tokenExp = exp;
    return true;
  }
  // Check if refresh token exists — can attempt silent refresh even if access token expired
  const hasRefresh = !!sessionStorage.getItem('ms_refresh_token');
  if (hasRefresh) {
    return true; // Caller should use getValidToken() which will trigger refresh
  }
  return false;
}

export function signOut() {
  sessionStorage.removeItem('ms_token');
  sessionStorage.removeItem('ms_token_exp');
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('ms_refresh_token');
  sessionStorage.clear();
  state.token = null;
  state.tokenExp = 0;
}

// ── Token refresh ──────────────────────────────────────────────────────────────

/**
 * Silently refresh the access token using the stored refresh token.
 * POSTs grant_type=refresh_token to the Microsoft token endpoint.
 * On success, calls saveToken with the new token data (rotating refresh token).
 * @returns {Promise<boolean>} true if refresh succeeded, false otherwise
 */
export async function refreshAccessToken() {
  const refreshToken = sessionStorage.getItem('ms_refresh_token');
  if (!refreshToken) return false;

  try {
    const body = new URLSearchParams({
      client_id:     CONFIG.CLIENT_ID,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      scope:         SCOPES,
    });

    const resp = await fetch(
      `https://login.microsoftonline.com/${CONFIG.TENANT_ID}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
    );

    if (!resp.ok) {
      console.error('Token refresh failed', resp.status);
      return false;
    }

    const data = await resp.json();
    saveToken(data);
    return true;
  } catch (err) {
    console.error('Token refresh error:', err);
    return false;
  }
}

/**
 * Get a valid access token, refreshing silently if within 5 min of expiry.
 * @returns {Promise<string|null>} access token or null if unavailable
 */
export async function getValidToken() {
  if (!state.token) return null;

  const timeLeft = state.tokenExp - Date.now();
  const REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes

  if (timeLeft > REFRESH_THRESHOLD) {
    return state.token;
  }

  // Token is expired or about to expire — try refresh
  const refreshed = await refreshAccessToken();
  if (refreshed) {
    return state.token;
  }

  // Refresh failed — return existing token if not fully expired, else null
  if (timeLeft > 0) {
    return state.token;
  }
  return null;
}
