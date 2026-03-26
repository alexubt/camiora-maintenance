/**
 * Unit tests for worker/api-proxy.js
 * Run: node --test api-proxy.test.js
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from './api-proxy.js';

const ALLOWED_ORIGIN = 'https://alexubt.github.io';
const WORKER_URL = 'https://camiora-api-proxy.workers.dev';

const mockEnv = {
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  SAMSARA_API_KEY: 'test-samsara-key',
  ALLOWED_ORIGIN: ALLOWED_ORIGIN,
};

// Base64 encoded "fake image data"
const FAKE_IMAGE_B64 = Buffer.from('fake image data').toString('base64');

// Save original fetch
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Test 1: OPTIONS preflight returns 204 with POST in Allow-Methods
// ---------------------------------------------------------------------------
test('OPTIONS preflight returns 204 with POST in Access-Control-Allow-Methods', async () => {
  const req = new Request(`${WORKER_URL}/extract-invoice`, {
    method: 'OPTIONS',
    headers: { Origin: ALLOWED_ORIGIN },
  });

  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 204);
  assert.ok(
    res.headers.get('Access-Control-Allow-Methods').includes('POST'),
    'Allow-Methods should include POST'
  );
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN);
});

// ---------------------------------------------------------------------------
// Test 2: POST /extract-invoice with valid image calls Anthropic with correct
//         model, headers, and image content block
// ---------------------------------------------------------------------------
test('POST /extract-invoice with image payload calls Anthropic API with image content block', async () => {
  const capturedRequests = [];

  globalThis.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    const extraction = {
      unit_number: '1108',
      date: '2026-03-01',
      vendor: 'Test Garage',
      vendor_address: null,
      invoice_number: 'INV-001',
      total_cost: 250.0,
      labor_cost: 100.0,
      parts_cost: 150.0,
      summary: 'Oil change and filter replacement',
      line_items: [],
      detected_milestones: ['PM'],
      confidence: 0.95,
    };
    return new Response(
      JSON.stringify({ content: [{ text: JSON.stringify(extraction) }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const req = new Request(`${WORKER_URL}/extract-invoice`, {
    method: 'POST',
    headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: FAKE_IMAGE_B64,
      mimeType: 'image/jpeg',
      fleet: ['1108', '1115', '1165'],
    }),
  });

  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 200);
  assert.equal(capturedRequests.length, 1);

  const [called] = capturedRequests;
  assert.ok(called.url.includes('api.anthropic.com'), 'should call Anthropic API');
  assert.equal(called.options.headers['x-api-key'], 'test-anthropic-key');
  assert.equal(called.options.headers['anthropic-version'], '2023-06-01');

  const sentBody = JSON.parse(called.options.body);
  assert.equal(sentBody.model, 'claude-haiku-4-5-20251001');
  assert.ok(sentBody.max_tokens, 'max_tokens should be set');

  const contentBlock = sentBody.messages[0].content[0];
  assert.equal(contentBlock.type, 'image', 'should use image content block for JPEG');
  assert.equal(contentBlock.source.type, 'base64');
  assert.equal(contentBlock.source.media_type, 'image/jpeg');
  assert.equal(contentBlock.source.data, FAKE_IMAGE_B64);

  // Fleet roster should appear in the prompt text
  const textBlock = sentBody.messages[0].content[1];
  assert.equal(textBlock.type, 'text');
  assert.ok(textBlock.text.includes('1108'), 'prompt should include fleet roster');

  const result = await res.json();
  assert.equal(result.unit_number, '1108');
});

// ---------------------------------------------------------------------------
// Test 3: POST /extract-invoice with PDF uses document content block
// ---------------------------------------------------------------------------
test('POST /extract-invoice with PDF payload uses document content block', async () => {
  const capturedRequests = [];

  globalThis.fetch = async (url, options) => {
    capturedRequests.push({ url, options });
    const extraction = { unit_number: null, date: null, vendor: null, vendor_address: null,
      invoice_number: null, total_cost: null, labor_cost: null, parts_cost: null,
      summary: 'Brake inspection', line_items: [], detected_milestones: ['brake-inspection'],
      confidence: 0.8 };
    return new Response(
      JSON.stringify({ content: [{ text: JSON.stringify(extraction) }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const req = new Request(`${WORKER_URL}/extract-invoice`, {
    method: 'POST',
    headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: FAKE_IMAGE_B64,
      mimeType: 'application/pdf',
      fleet: ['1108'],
    }),
  });

  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 200);

  const sentBody = JSON.parse(capturedRequests[0].options.body);
  const contentBlock = sentBody.messages[0].content[0];
  assert.equal(contentBlock.type, 'document', 'should use document content block for PDF');
  assert.equal(contentBlock.source.media_type, 'application/pdf');
});

// ---------------------------------------------------------------------------
// Test 4: POST /extract-invoice with missing image field returns 400
// ---------------------------------------------------------------------------
test('POST /extract-invoice missing image field returns 400', async () => {
  const req = new Request(`${WORKER_URL}/extract-invoice`, {
    method: 'POST',
    headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType: 'image/jpeg' }),
  });

  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'missing_fields');
});

// ---------------------------------------------------------------------------
// Test 5: POST /extract-invoice with invalid JSON body returns 400
// ---------------------------------------------------------------------------
test('POST /extract-invoice with invalid JSON body returns 400', async () => {
  const req = new Request(`${WORKER_URL}/extract-invoice`, {
    method: 'POST',
    headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
    body: 'this is not json {{{',
  });

  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid_json');
});

// ---------------------------------------------------------------------------
// Test 6: Upstream Anthropic error returns 502
// ---------------------------------------------------------------------------
test('upstream Anthropic error returns 502', async () => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: { type: 'authentication_error' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const req = new Request(`${WORKER_URL}/extract-invoice`, {
    method: 'POST',
    headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: FAKE_IMAGE_B64, mimeType: 'image/jpeg', fleet: [] }),
  });

  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'upstream_error');
});

// ---------------------------------------------------------------------------
// Test 7: Claude response wrapped in markdown code block is parsed correctly
// ---------------------------------------------------------------------------
test('Claude markdown-wrapped JSON response is parsed correctly', async () => {
  globalThis.fetch = async () => {
    const extraction = {
      unit_number: '1165',
      date: '2026-03-15',
      vendor: 'Truck Stop',
      vendor_address: null,
      invoice_number: null,
      total_cost: 500.0,
      labor_cost: 200.0,
      parts_cost: 300.0,
      summary: 'DPF cleaning',
      line_items: [],
      detected_milestones: ['dpf-cleaning'],
      confidence: 0.9,
    };
    // Wrap in markdown code block
    const markdownText = '```json\n' + JSON.stringify(extraction) + '\n```';
    return new Response(
      JSON.stringify({ content: [{ text: markdownText }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const req = new Request(`${WORKER_URL}/extract-invoice`, {
    method: 'POST',
    headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: FAKE_IMAGE_B64, mimeType: 'image/jpeg', fleet: ['1165'] }),
  });

  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.unit_number, '1165');
  assert.deepEqual(result.detected_milestones, ['dpf-cleaning']);
});

// ---------------------------------------------------------------------------
// Test 8: Unauthorized origin returns 403
// ---------------------------------------------------------------------------
test('request from unauthorized origin returns 403', async () => {
  const req = new Request(`${WORKER_URL}/extract-invoice`, {
    method: 'POST',
    headers: { Origin: 'https://evil.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: FAKE_IMAGE_B64, mimeType: 'image/jpeg', fleet: [] }),
  });

  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'unauthorized');
});

// ---------------------------------------------------------------------------
// Test 9: GET /vehicles/stats still works (existing functionality preserved)
// ---------------------------------------------------------------------------
test('GET /vehicles/stats proxies to Samsara unchanged', async () => {
  globalThis.fetch = async (url, options) => {
    assert.ok(url.includes('samsara.com'), 'should call Samsara API');
    assert.ok(
      options.headers.Authorization.includes('test-samsara-key'),
      'should include Samsara API key'
    );
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const req = new Request(`${WORKER_URL}/vehicles/stats?types=engineStates`, {
    method: 'GET',
    headers: { Origin: ALLOWED_ORIGIN },
  });

  const res = await worker.fetch(req, mockEnv);

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data));
});
