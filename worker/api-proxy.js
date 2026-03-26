/**
 * Cloudflare Worker — API proxy (Samsara + Invoice Extraction).
 * Stores API keys as Worker secrets (SAMSARA_API_KEY, ANTHROPIC_API_KEY).
 * Locks CORS to the app's GitHub Pages origin.
 *
 * Routes:
 *   GET  /vehicles/stats  — Samsara fleet vehicle stats proxy
 *   POST /extract-invoice — Claude Haiku 4.5 vision invoice extraction
 *
 * Deploy:
 *   cd worker && wrangler deploy
 *   wrangler secret put SAMSARA_API_KEY
 *   wrangler secret put ANTHROPIC_API_KEY
 */

const SAMSARA_BASE = 'https://api.samsara.com';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

function corsHeaders(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': origin === allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600',
  };
}

/**
 * Builds the extraction prompt for Claude with the fleet roster embedded.
 * @param {string[]} fleet - Array of unit number strings
 * @returns {string}
 */
function buildExtractionPrompt(fleet) {
  const roster = Array.isArray(fleet) ? fleet.join(', ') : '';
  return `You are analyzing a fleet maintenance invoice. Extract the following from the document.

CRITICAL — HANDWRITTEN UNIT NUMBER DETECTION:
Unit numbers are often handwritten on invoices. Handwritten "1"s frequently look like:
- Capital I (e.g., "II15" is actually "1115")
- Vertical sticks/lines | (e.g., "||45" is actually "1145")
- Lowercase L (e.g., "ll22" is actually "1122")
- A mix of these (e.g., "Il65" is actually "1165")

When you see any sequence of I, l, |, or 1 characters in handwriting, treat ALL of them as the digit "1" and match against the fleet roster below. For example:
- "IIII" or "llll" → try "1111"
- "II65" or "Il65" → try "1165"
- "II08" → try "1108"

Fleet roster (match unit number against these): [${roster}]
Only return a complete, confident match — do not guess partial numbers.

Map invoice descriptions to these milestone types where applicable:
- "PM", "preventive maintenance", "oil change", "lube" → PM
- "DPF", "DOC", "diesel particulate" → dpf-cleaning
- "transmission oil", "trans service" → transmission-oil
- "differential oil", "diff oil" → differential-oil
- "engine air filter", "air filter" → engine-air-filter
- "air dryer", "desiccant" → air-dryer
- "belts", "tensioner" → belts-tensioners
- "brake", "brake inspection" → brake-inspection
- "alignment" → alignment
- "steer tire", "new steers" → steer-tires
- "drive tire", "new drives" → drive-tires
- "batteries", "battery", "new batteries" → batteries

Return JSON only — no markdown, no explanation. Use this exact schema:

{
  "unit_number": string | null,
  "date": "YYYY-MM-DD" | null,
  "vendor": string | null,
  "vendor_address": string | null,
  "invoice_number": string | null,
  "total_cost": number | null,
  "labor_cost": number | null,
  "parts_cost": number | null,
  "summary": "one-line description of work performed",
  "line_items": [{ "description": string, "amount": number }],
  "detected_milestones": string[],
  "confidence": number
}`;
}

/**
 * Handles POST /extract-invoice — calls Claude Haiku 4.5 Vision API.
 */
async function handleExtractInvoice(request, env, origin, allowed) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) };

  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers });
  }

  // Validate required fields
  if (!body.image || !body.mimeType) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400, headers });
  }

  const { image, mimeType, fleet = [] } = body;

  // Build content block — PDF uses "document" type, images use "image" type
  let contentBlock;
  if (mimeType === 'application/pdf') {
    contentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: image },
    };
  } else {
    contentBlock = {
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: image },
    };
  }

  const prompt = buildExtractionPrompt(fleet);

  // Call Anthropic Messages API
  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              contentBlock,
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'upstream_error', detail: err.message }),
      { status: 502, headers }
    );
  }

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text();
    return new Response(
      JSON.stringify({ error: 'upstream_error', detail }),
      { status: 502, headers }
    );
  }

  const data = await anthropicRes.json();
  const rawText = data.content[0].text;

  // Parse JSON — handle both raw JSON and markdown-wrapped response
  let extraction;
  try {
    extraction = JSON.parse(rawText);
  } catch {
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        extraction = JSON.parse(match[1]);
      } catch {
        return new Response(
          JSON.stringify({ error: 'extraction_failed', message: 'not valid JSON' }),
          { status: 502, headers }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'extraction_failed', message: 'not valid JSON' }),
        { status: 502, headers }
      );
    }
  }

  return new Response(JSON.stringify(extraction), { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || 'https://alexubt.github.io';

    // CORS preflight — gate on origin
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

    // Route dispatch — POST /extract-invoice (before GET-only guard)
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/extract-invoice') {
      return handleExtractInvoice(request, env, origin, allowed);
    }

    // Only GET allowed for remaining routes
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }

    // Route: /vehicles/stats — proxy to Samsara
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
