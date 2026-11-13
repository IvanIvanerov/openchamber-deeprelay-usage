import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';

import { parseManifestJson, quotaProviderSchemasV1 as schemas } from '@openchamber/sdk/schemas';

import { createServer } from '../service/main.js';
import { createSubscriptionReader } from '../service/lib/deeprelay.js';

const TOKEN = 'test-token';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const jsonResponse = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });

const fakeFetch = (subscription, balance) => async (url) => {
  if (url.endsWith('/billing/subscription')) return jsonResponse(subscription);
  if (url.endsWith('/billing/balance')) return jsonResponse(balance);
  return jsonResponse({ error: 'not found' }, 404);
};

let server;
let origin;

const call = async (body, { token = TOKEN } = {}) => {
  const response = await fetch(`${origin}/quota`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const quotaCall = (credentials) => ({
  v: 1,
  requestId: 'test-request',
  method: 'usage.read',
  provider: 'ext-deeprelay',
  input: { credentials },
});

before(async () => {
  const subscription = await fixture('subscription.json');
  const balance = await fixture('balance.json');
  const reader = createSubscriptionReader({ fetchImpl: fakeFetch(subscription, balance) });
  server = createServer({ token: TOKEN, reader });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test('the answer parses as the quota wire the host expects', async () => {
  const { status, body } = await call(quotaCall({ deeprelay: { type: 'api', key: 'deeprelay_live_x' } }));

  assert.equal(status, 200);
  const envelope = schemas.envelope.safeParse(body);
  assert.ok(envelope.success, 'the envelope must match quotaProviderSchemasV1.envelope');
  assert.ok(envelope.data.ok);

  const usage = schemas.data['usage.read'].safeParse(envelope.data.data);
  assert.ok(usage.success, 'the answer must match quotaProviderSchemasV1.data["usage.read"]');
  assert.equal(usage.data.ok, true);
  assert.equal(usage.data.configured, true);
  assert.equal(usage.data.planLabel, 'Plus · $4.99/mo');
  assert.equal(Object.keys(usage.data.usage.windows).length, 7);
  assert.equal(Object.keys(usage.data.usage.models).length, 2);
});

test('a provider the user has no credential for reads as not configured', async () => {
  const { status, body } = await call(quotaCall({}));

  assert.equal(status, 200);
  assert.equal(body.data.ok, true);
  assert.equal(body.data.configured, false);
  assert.equal(body.data.usage, null);
});

test('a call without the bearer token is refused', async () => {
  const { status } = await call(quotaCall({ deeprelay: { type: 'api', key: 'x' } }), { token: 'wrong' });
  assert.equal(status, 401);
});

test('a call of another wire version is refused', async () => {
  const { status } = await call({ ...quotaCall({}), v: 99 });
  assert.equal(status, 400);
});

test('a call of another method is refused', async () => {
  const { status } = await call({ ...quotaCall({}), method: 'usage.write' });
  assert.equal(status, 400);
});

test('the manifest of this package is one the host accepts', async () => {
  const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const parsed = parseManifestJson(raw);

  assert.ok(parsed.ok, `the manifest must parse: ${JSON.stringify(parsed.error ?? null)}`);
  assert.equal(parsed.manifest.contributes.service.provides[0], 'quota');
  assert.deepEqual(parsed.manifest.contributes.quota.providers, ['deeprelay']);
});
