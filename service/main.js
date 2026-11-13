/**
 * The usage provider OpenChamber talks to.
 *
 * Wire 1 of the quota role: OpenChamber posts one call to `/quota` on this
 * service's loopback and parses the answer against `quotaProviderSchemasV1`.
 * The credentials of exactly the provider ids the manifest lists arrive in
 * every request, so the DeepRelay key never leaves OpenCode's store: this
 * service only forwards it to DeepRelay's own API.
 *
 * Success answer: { ok: true, data: { ok, configured, planLabel, usage } }
 * Failure answer: { ok: false, error: { message } }
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { PROVIDER_ID, buildUsage, createSubscriptionReader, readApiKey } from './lib/deeprelay.js';

const WIRE_VERSION = 1;
const MAX_BODY_BYTES = 256 * 1024;

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });

const json = (response, status, body) => {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
};

export const createServer = ({ token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '', reader = createSubscriptionReader() } = {}) => {
  const handleQuota = async (response, request) => {
    let envelope;
    try {
      envelope = JSON.parse(await readBody(request));
    } catch {
      return json(response, 400, { ok: false, error: { message: 'Malformed request' } });
    }
    if (envelope?.v !== WIRE_VERSION || envelope?.method !== 'usage.read') {
      return json(response, 400, { ok: false, error: { message: 'Unsupported quota call' } });
    }

    const credentials = envelope?.input?.credentials;
    if (!credentials || typeof credentials !== 'object') {
      return json(response, 400, { ok: false, error: { message: 'No credentials in the request' } });
    }

    const apiKey = readApiKey(credentials, PROVIDER_ID);
    if (!apiKey) {
      return json(response, 200, { ok: true, data: { ok: true, configured: false, usage: null } });
    }

    try {
      const { subscription, balance } = await reader.read(apiKey);
      const usage = buildUsage(subscription, balance);
      if (Object.keys(usage.windows).length === 0) {
        return json(response, 200, {
          ok: true,
          data: { ok: false, configured: true, error: 'DeepRelay reported no usage data' },
        });
      }
      return json(response, 200, {
        ok: true,
        data: {
          ok: true,
          configured: true,
          planLabel: usage.planLabel,
          usage: { windows: usage.windows, ...(usage.models ? { models: usage.models } : {}) },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'DeepRelay could not be reached';
      return json(response, 200, { ok: false, error: { message } });
    }
  };

  return http.createServer((request, response) => {
    if (token && request.headers.authorization !== `Bearer ${token}`) {
      return json(response, 401, { ok: false, error: { message: 'Unauthorized' } });
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') {
      return json(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/quota') {
      return handleQuota(response, request);
    }
    return json(response, 404, { ok: false, error: { message: 'Not found' } });
  });
};

// The host spawns this file with the port and the token in the environment.
// Tests import the server instead of running it.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
  const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
  if (!port || !token) {
    console.error('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
    process.exit(1);
  }
  createServer({ token }).listen(port, '127.0.0.1');
}
