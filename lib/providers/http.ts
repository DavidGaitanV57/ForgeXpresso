export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}

export async function readError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    return j?.error?.message || j?.detail?.message || j?.detail || j?.message || j?.base_resp?.status_msg || text.slice(0, 400);
  } catch {
    return text.slice(0, 400) || res.statusText;
  }
}

export async function fetchWithRetry(url: string, init: RequestInit, opts: { retries?: number; provider: string; timeoutMs?: number }) {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (res.ok) return res;
      const msg = await readError(res);
      const err = new ProviderError(opts.provider, res.status, String(msg));
      if (res.status === 429 || res.status >= 500) {
        lastErr = err;
        await sleep(1500 * (i + 1) ** 2);
        continue;
      }
      throw err;
    } catch (e) {
      if (e instanceof ProviderError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
      if (i < retries) await sleep(1500 * (i + 1) ** 2);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
