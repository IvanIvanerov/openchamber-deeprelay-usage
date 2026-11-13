import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  buildModels,
  buildUsage,
  buildWindows,
  createSubscriptionReader,
  formatMoney,
  formatTokens,
  planLabel,
  readApiKey,
  share,
} from '../service/lib/deeprelay.js';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('token counts are read in the units the plan is written in', () => {
  assert.equal(formatTokens(125000000), '125.0M');
  assert.equal(formatTokens(2500000000), '2.5B');
  assert.equal(formatTokens(62500000), '62.5M');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1500), '1.5K');
});

test('money keeps its cents', () => {
  assert.equal(formatMoney(19.51262551), '$19.51');
  assert.equal(formatMoney(0), '$0.00');
});

test('a share past the limit stays past the limit', () => {
  assert.equal(share(50, 100), 50);
  assert.ok(Math.abs(share(625100000, 625000000) - 100.016) < 1e-9);
  assert.equal(share(10, 0), null);
});

test('the credential of the listed provider is read as OpenCode keeps it', () => {
  assert.equal(readApiKey({ deeprelay: { type: 'api', key: 'deeprelay_live_x' } }), 'deeprelay_live_x');
  assert.equal(readApiKey({ deeprelay: 'deeprelay_live_x' }), 'deeprelay_live_x');
  assert.equal(readApiKey({ deeprelay: { type: 'api', key: '  ' } }), null);
  assert.equal(readApiKey({ other: { type: 'api', key: 'x' } }), null);
});

test('every meter of the plan becomes a window', async () => {
  const subscription = await fixture('subscription.json');
  const balance = await fixture('balance.json');
  const windows = buildWindows(subscription, balance);

  assert.deepEqual(Object.keys(windows), [
    'Monthly input',
    'Monthly output',
    'Weekly input',
    'Weekly output',
    'Usage cap',
    'Web searches',
    'Credit balance',
  ]);

  assert.equal(windows['Monthly input'].usedPercent, 5);
  assert.equal(windows['Monthly input'].valueLabel, '125.0M / 2.5B tokens');
  assert.equal(windows['Monthly input'].resetAt, Date.parse('2026-12-10T20:17:05Z'));

  assert.equal(windows['Monthly output'].usedPercent, 5);
  assert.equal(windows['Monthly output'].valueLabel, '12.5M / 250.0M tokens');

  // The weekly caps slide, so they carry a duration and no reset date.
  assert.equal(windows['Weekly input'].usedPercent, 10);
  assert.equal(windows['Weekly input'].windowSeconds, 604800);
  assert.equal(windows['Weekly input'].resetAt, undefined);
});

test('the usage ceiling is read in dollars, not in micro-cents', async () => {
  const subscription = await fixture('subscription.json');
  const windows = buildWindows(subscription, await fixture('balance.json'));

  assert.equal(windows['Usage cap'].valueLabel, '$19.51 / $500.00');
  assert.deepEqual(windows['Usage cap'].value, { kind: 'spend', spent: 19.51262551, limit: 500 });
  assert.equal(windows['Usage cap'].usedPercent, 3.902525102);
});

test('the search allowance counts what was used', async () => {
  const subscription = await fixture('subscription.json');
  const windows = buildWindows(subscription, await fixture('balance.json'));

  assert.equal(windows['Web searches'].valueLabel, '12 / 500');
  assert.deepEqual(windows['Web searches'].value, { kind: 'requests', count: 12 });
});

test('the wallet balance is a figure, not a share', async () => {
  const subscription = await fixture('subscription.json');
  const windows = buildWindows(subscription, await fixture('balance.json'));

  assert.equal(windows['Credit balance'].usedPercent, null);
  assert.equal(windows['Credit balance'].valueLabel, '$42.50');
});

test('a missing balance leaves the balance window out', async () => {
  const subscription = await fixture('subscription.json');
  const windows = buildWindows(subscription, null);

  assert.equal(windows['Credit balance'], undefined);
});

test('an organization without a subscription says so', () => {
  const windows = buildWindows({ subscribed: false, quota: {}, usage: {} }, null);

  assert.equal(windows['Plan'].valueLabel, 'No active subscription');
});

test('every model that took from the plan gets its own windows', async () => {
  const subscription = await fixture('subscription.json');
  const { models } = buildModels(subscription);

  assert.deepEqual(Object.keys(models), [
    'deeprelay/deepseek-v4.1-flash',
    'deeprelay/glm-5.3-flash',
  ]);
  assert.equal(models['deeprelay/deepseek-v4.1-flash'].windows.Input.valueLabel, '100.0M tokens');
  assert.equal(models['deeprelay/deepseek-v4.1-flash'].windows.Output.valueLabel, '10.0M tokens');
  assert.equal(models['deeprelay/glm-5.3-flash'].windows.Input.usedPercent, null);
});

test('the plan is named with its tier and price', async () => {
  const subscription = await fixture('subscription.json');
  assert.equal(planLabel(subscription), 'Plus · $4.99/mo');

  const cancelling = { ...subscription, cancel_at_period_end: true };
  assert.equal(planLabel(cancelling), 'Plus · $4.99/mo · cancels at period end');

  assert.equal(planLabel({}), null);
});

test('the usage of one answer carries the windows, the models and the plan', async () => {
  const subscription = await fixture('subscription.json');
  const balance = await fixture('balance.json');
  const usage = buildUsage(subscription, balance);

  assert.equal(Object.keys(usage.windows).length, 7);
  assert.equal(Object.keys(usage.models).length, 2);
  assert.equal(usage.planLabel, 'Plus · $4.99/mo');
});

test('a later read answers from the last good one and refreshes behind it', async () => {
  const subscription = await fixture('subscription.json');
  const balance = await fixture('balance.json');
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fetchImpl = async (url) => {
    await delay(120);
    const body = url.endsWith('/billing/subscription') ? subscription : balance;
    return { ok: true, status: 200, json: async () => body };
  };
  const reader = createSubscriptionReader({ fetchImpl });

  await reader.read('deeprelay_live_x');

  const started = Date.now();
  const answer = await reader.read('deeprelay_live_x');
  const elapsed = Date.now() - started;

  assert.equal(answer.subscription.plan.name, 'Plus');
  assert.ok(elapsed < 100, `the second read must not wait for the upstream (${elapsed}ms)`);
});

test('a failing upstream leaves the last good answer in place', async () => {
  const subscription = await fixture('subscription.json');
  const balance = await fixture('balance.json');
  let failing = false;
  const fetchImpl = async (url) => {
    if (failing) throw new Error('upstream is down');
    const body = url.endsWith('/billing/subscription') ? subscription : balance;
    return { ok: true, status: 200, json: async () => body };
  };
  const reader = createSubscriptionReader({ fetchImpl, attemptTimeoutsMs: [10] });

  await reader.read('deeprelay_live_x');
  failing = true;

  const answer = await reader.read('deeprelay_live_x');
  assert.equal(answer.subscription.plan.name, 'Plus');
});
