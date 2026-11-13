/**
 * DeepRelay plan, quota and spend, mapped to the shape OpenChamber's Usage
 * page draws: windows with a share, a label and an optional reset, plus the
 * per-model breakdown.
 *
 * Everything here is pure: the numbers come in, the windows go out. The
 * transport lives in `service/main.js`.
 */

export const PROVIDER_ID = 'deeprelay';
export const API_BASE = 'https://api.deeprelay.ai/v1';
export const SUBSCRIPTION_URL = `${API_BASE}/billing/subscription`;
export const BALANCE_URL = `${API_BASE}/billing/balance`;

/** DeepRelay's billing route sits behind a load balancer with slow cold backends. */
export const DEFAULT_ATTEMPT_TIMEOUTS_MS = [13_000, 5_000];
export const DEFAULT_BALANCE_TIMEOUT_MS = 12_000;
/** A refresh that runs behind the call may take longer than one the call waits for. */
export const DEFAULT_BACKGROUND_TIMEOUT_MS = 25_000;
/** How old a kept answer may be before the card is better empty than stale. */
export const DEFAULT_CACHE_MAX_AGE_MS = 10 * 60_000;

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The quota wire carries timestamps in milliseconds. */
export const timestamp = (value) => {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * DeepRelay counts weighted tokens: a model's usage factor multiplies what
 * its tokens cost against the allowance, so the same numbers gate the meters.
 */
export const formatTokens = (value) => {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
};

export const formatMoney = (dollars) => `$${dollars.toFixed(2)}`;

/**
 * Past 100% is real: the weekly caps are independent of the monthly ones and
 * a meter can run out while the month still has room.
 */
export const share = (used, limit) => (limit > 0 ? Math.max(0, (used / limit) * 100) : null);

/**
 * The credential of one provider, as OpenCode keeps it. OpenChamber hands the
 * service the entries for exactly the provider ids the manifest lists.
 */
export const readApiKey = (credentials, providerId = PROVIDER_ID) => {
  const entry = credentials?.[providerId];
  if (typeof entry === 'string') return entry.trim() || null;
  const key = typeof entry?.key === 'string' ? entry.key : typeof entry?.apiKey === 'string' ? entry.apiKey : '';
  return key.trim() || null;
};

/**
 * One window per meter DeepRelay enforces: the two monthly token meters, the
 * two rolling weekly ones, the metered-usage ceiling in dollars, the monthly
 * web-search allowance, and the wallet balance.
 */
export const buildWindows = (subscription, balance) => {
  const quota = subscription?.quota ?? {};
  const usage = subscription?.usage ?? {};
  const windows = {};

  const monthlyInputLimit = number(quota.input_tokens_monthly);
  const monthlyInputUsed = number(usage.weighted_input_tokens);
  if (monthlyInputLimit && monthlyInputUsed !== null) {
    windows['Monthly input'] = {
      usedPercent: share(monthlyInputUsed, monthlyInputLimit),
      resetAt: timestamp(subscription?.current_period_end),
      valueLabel: `${formatTokens(monthlyInputUsed)} / ${formatTokens(monthlyInputLimit)} tokens`,
    };
  }

  const monthlyOutputLimit = number(quota.output_tokens_monthly);
  const monthlyOutputUsed = number(usage.weighted_output_tokens);
  if (monthlyOutputLimit && monthlyOutputUsed !== null) {
    windows['Monthly output'] = {
      usedPercent: share(monthlyOutputUsed, monthlyOutputLimit),
      resetAt: timestamp(subscription?.current_period_end),
      valueLabel: `${formatTokens(monthlyOutputUsed)} / ${formatTokens(monthlyOutputLimit)} tokens`,
    };
  }

  const weeklyInputLimit = number(quota.weekly_input_tokens);
  const weeklyInputUsed = number(usage.weekly_weighted_input_tokens);
  if (weeklyInputLimit && weeklyInputUsed !== null) {
    windows['Weekly input'] = {
      usedPercent: share(weeklyInputUsed, weeklyInputLimit),
      // The weekly caps slide, so they have no reset date.
      windowSeconds: 7 * 24 * 60 * 60,
      valueLabel: `${formatTokens(weeklyInputUsed)} / ${formatTokens(weeklyInputLimit)} tokens`,
    };
  }

  const weeklyOutputLimit = number(quota.weekly_output_tokens);
  const weeklyOutputUsed = number(usage.weekly_weighted_output_tokens);
  if (weeklyOutputLimit && weeklyOutputUsed !== null) {
    windows['Weekly output'] = {
      usedPercent: share(weeklyOutputUsed, weeklyOutputLimit),
      windowSeconds: 7 * 24 * 60 * 60,
      valueLabel: `${formatTokens(weeklyOutputUsed)} / ${formatTokens(weeklyOutputLimit)} tokens`,
    };
  }

  // The backstop counts plan usage at list price and stops plan coverage once
  // it is reached, whatever the token meters say. Micro-cents are a millionth
  // of a cent, so a hundred million of them are one dollar.
  const capLimit = number(quota.max_usage_micro_cents);
  if (capLimit && capLimit > 0) {
    const limit = capLimit / 1e8;
    const spent = (number(usage.cost_micro_cents) ?? 0) / 1e8;
    windows['Usage cap'] = {
      usedPercent: share(spent, limit),
      valueLabel: `${formatMoney(spent)} / ${formatMoney(limit)}`,
      value: { kind: 'spend', spent, limit },
    };
  }

  const searchLimit = number(quota.searches_monthly);
  if (searchLimit && searchLimit > 0) {
    const searches = number(usage.searches) ?? 0;
    windows['Web searches'] = {
      usedPercent: share(searches, searchLimit),
      valueLabel: `${searches} / ${searchLimit}`,
      value: { kind: 'requests', count: searches },
    };
  }

  const balanceCents = number(balance?.balance_cents);
  if (balanceCents !== null) {
    windows['Credit balance'] = {
      usedPercent: null,
      valueLabel: formatMoney(balanceCents / 100),
    };
  }

  if (subscription?.subscribed !== true) {
    windows['Plan'] = {
      usedPercent: null,
      valueLabel: 'No active subscription',
    };
  }

  return windows;
};

/**
 * Per-model windows: what each model took of the plan this period. There is
 * no per-model allowance, so the window carries the absolute figure.
 */
export const buildModels = (subscription) => {
  const byModel = Array.isArray(subscription?.usage?.by_model) ? subscription.usage.by_model : [];
  const models = {};
  for (const entry of byModel) {
    const id = typeof entry?.model === 'string' ? entry.model.trim() : '';
    if (!id) continue;
    const input = number(entry.weighted_input_tokens) ?? 0;
    const output = number(entry.weighted_output_tokens) ?? 0;
    models[id] = {
      windows: {
        Input: { usedPercent: null, valueLabel: `${formatTokens(input)} tokens` },
        Output: { usedPercent: null, valueLabel: `${formatTokens(output)} tokens` },
      },
    };
  }
  return Object.keys(models).length > 0 ? { models } : {};
};

/** The plan as the card names it: tier, price, and a pending cancellation. */
export const planLabel = (subscription) => {
  const plan = subscription?.plan;
  const name = typeof plan?.name === 'string' ? plan.name.trim() : '';
  if (!name) return null;
  const cents = number(plan?.price?.amount_cents);
  const interval = plan?.price?.interval === 'month' ? '/mo' : '';
  const price = cents !== null ? ` · $${(cents / 100).toFixed(2)}${interval}` : '';
  const cancelling = subscription?.cancel_at_period_end === true ? ' · cancels at period end' : '';
  return `${name}${price}${cancelling}`;
};

/** Everything the Usage card needs from one pair of API answers. */
export const buildUsage = (subscription, balance) => ({
  windows: buildWindows(subscription, balance),
  ...buildModels(subscription),
  planLabel: planLabel(subscription),
});

const fetchJson = async (fetchImpl, url, apiKey, timeoutMs) => {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('DeepRelay rejected the API key');
    }
    const error = new Error(`DeepRelay returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

/** A timeout or a 5xx is worth another try; a rejected key is not. */
export const isRetryable = (error) => {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return true;
  return typeof error?.status === 'number' && error.status >= 500;
};

/**
 * Reads the subscription.
 *
 * DeepRelay's cold backends answer in ten seconds and sometimes in twenty,
 * while OpenChamber waits twenty seconds for the whole call. So the first
 * read of a period waits for the answer, two short attempts at a time, and
 * every later read answers from the last good one while a refresh runs
 * behind it. A slow upstream then costs freshness, not the card.
 */
export const createSubscriptionReader = ({
  fetchImpl = fetch,
  attemptTimeoutsMs = DEFAULT_ATTEMPT_TIMEOUTS_MS,
  balanceTimeoutMs = DEFAULT_BALANCE_TIMEOUT_MS,
  backgroundTimeoutMs = DEFAULT_BACKGROUND_TIMEOUT_MS,
  cacheMaxAgeMs = DEFAULT_CACHE_MAX_AGE_MS,
} = {}) => {
  let cache = null;
  let cachedAt = 0;
  let refreshing = null;

  const fetchSubscription = async (apiKey, timeouts) => {
    let failure;
    for (const timeoutMs of timeouts) {
      try {
        return await fetchJson(fetchImpl, SUBSCRIPTION_URL, apiKey, timeoutMs);
      } catch (error) {
        failure = error;
        if (!isRetryable(error)) break;
      }
    }
    throw failure;
  };

  const refresh = async (apiKey, timeouts) => {
    const [subscription, balance] = await Promise.all([
      fetchSubscription(apiKey, timeouts),
      fetchJson(fetchImpl, BALANCE_URL, apiKey, balanceTimeoutMs).catch(() => null),
    ]);
    cache = { subscription, balance };
    cachedAt = Date.now();
    return cache;
  };

  const read = async (apiKey) => {
    if (cache && Date.now() - cachedAt < cacheMaxAgeMs) {
      // Answer now, refresh behind the call.
      if (!refreshing) {
        refreshing = refresh(apiKey, [backgroundTimeoutMs])
          .catch(() => null)
          .finally(() => {
            refreshing = null;
          });
      }
      return cache;
    }
    try {
      return await refresh(apiKey, attemptTimeoutsMs);
    } catch (error) {
      // A stale answer beats an empty card.
      if (cache) return cache;
      throw error;
    }
  };

  return {
    /** The plan and the balance behind one API key. */
    read,
  };
};
