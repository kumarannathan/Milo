// Every outbound call a provider makes goes through `io` so it shows up in
// "Recent tool calls" with its status code and latency.

export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number|string, code?: 'auth'|'rate_limit'|'network'|'bad_request'|'bad_response'|'not_found'|'unavailable', op?: string }} [info]
   */
  constructor(message, { status = 'error', code = 'bad_response', op } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.op = op;
  }
}

function codeForStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'not_found';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'unavailable';
}

function errorMessage(body, fallback) {
  if (!body) return fallback;
  if (typeof body === 'string') return body.slice(0, 300) || fallback;
  const msg =
    body.error?.message ??
    body.error_description ??
    (typeof body.error === 'string' ? body.error : null) ??
    body.message ??
    body.detail?.error ??
    (typeof body.detail === 'string' ? body.detail : null) ??
    body.errors?.[0]?.details ??
    body.errors?.[0]?.message;
  return msg ? String(msg).slice(0, 300) : fallback;
}

/**
 * @param {{ onCall?: (call: { op: string, status: number|string, ms: number }) => void }} opts
 */
export function createIo({ onCall = () => {} } = {}) {
  const record = (op, status, ms) => onCall({ op, status, ms: Math.round(ms) });

  return {
    record,

    /**
     * JSON-first fetch wrapper.
     * @param {string} op       label shown in the UI, e.g. "apollo.people_search"
     * @param {string} url
     * @param {{ method?: string, headers?: object, query?: object, json?: any, form?: object, body?: any, timeoutMs?: number, raw?: boolean }} [init]
     */
    async http(op, url, init = {}) {
      const { method = init.json || init.form ? 'POST' : 'GET', headers = {}, query, json, form, timeoutMs = 30_000 } = init;
      const target = new URL(url);
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          if (v === undefined || v === null) continue;
          if (Array.isArray(v)) v.forEach((item) => target.searchParams.append(k, String(item)));
          else target.searchParams.set(k, String(v));
        }
      }
      const h = { Accept: 'application/json', ...headers };
      let body = init.body;
      if (json !== undefined) {
        h['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
      } else if (form) {
        h['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(form).toString();
      }

      const started = performance.now();
      let res;
      try {
        res = await fetch(target, { method, headers: h, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        record(op, 'error', performance.now() - started);
        const timedOut = err?.name === 'TimeoutError';
        throw new ProviderError(timedOut ? `${op} timed out after ${timeoutMs / 1000}s` : `Could not reach ${target.host}`, {
          status: 'error',
          code: 'network',
          op,
        });
      }
      const ms = performance.now() - started;
      record(op, res.status, ms);

      const text = await res.text();
      let parsed = text;
      if ((res.headers.get('content-type') ?? '').includes('json') || /^[[{]/.test(text.trim())) {
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
      }
      if (!res.ok) {
        throw new ProviderError(errorMessage(parsed, `${op} failed with ${res.status}`), {
          status: res.status,
          code: codeForStatus(res.status),
          op,
        });
      }
      return init.raw ? { status: res.status, headers: res.headers, body: parsed } : parsed;
    },

    // For calls that are not plain HTTP (SMTP, IMAP, the demo provider).
    async track(op, fn) {
      const started = performance.now();
      try {
        const result = await fn();
        record(op, 200, performance.now() - started);
        return result;
      } catch (err) {
        const status = err instanceof ProviderError ? err.status : 'error';
        record(op, status, performance.now() - started);
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(err?.message ?? String(err), { op, code: err?.code === 'EAUTH' ? 'auth' : 'unavailable' });
      }
    },
  };
}

export function maskSecret(value) {
  if (!value) return '';
  const s = String(value);
  return `••••${s.slice(-4)}`;
}
