/**
 * Cloudflare Worker — Samsara API CORS proxy.
 * Stores the Samsara API key as a Worker secret (SAMSARA_API_KEY).
 * Locks CORS to the app's GitHub Pages origin.
 *
 * Deploy:
 *   cd worker && wrangler deploy
 *   wrangler secret put SAMSARA_API_KEY
 */

const SAMSARA_BASE = 'https://api.samsara.com';

function corsHeaders(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': origin === allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || 'https://alexubt.github.io';

    // CORS preflight — also gate on origin
    if (request.method === 'OPTIONS') {
      if (origin !== allowed) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }

    // Origin gate
    if (origin !== allowed) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Only GET allowed
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }

    // Route: /vehicles/stats — proxy to Samsara
    const url = new URL(request.url);
    if (url.pathname !== '/vehicles/stats') {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }

    try {
      const samsaraUrl = `${SAMSARA_BASE}/fleet/vehicles/stats${url.search}`;
      const upstream = await fetch(samsaraUrl, {
        headers: { Authorization: `Bearer ${env.SAMSARA_API_KEY}` },
      });

      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin, allowed),
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'upstream_error', message: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }
  },
};
