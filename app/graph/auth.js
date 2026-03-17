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

export const SCOPES = 'Files.ReadWrite User.Read';
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

export function saveToken(token, expiresIn) {
  sessionStorage.setItem('ms_token', token);
  sessionStorage.setItem('ms_token_exp', Date.now() + (expiresIn || 3600) * 1000);
  state.token = token;
  state.tokenExp = Date.now() + (expiresIn || 3600) * 1000;
}

export function loadToken() {
  const token = sessionStorage.getItem('ms_token');
  const exp   = parseInt(sessionStorage.getItem('ms_token_exp') || '0');
  if (token && Date.now() < exp) {
    state.token = token;
    state.tokenExp = exp;
    return true;
  }
  return false;
}

export function signOut() {
  sessionStorage.clear();
  state.token = null;
  state.tokenExp = 0;
}
