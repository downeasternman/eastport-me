export interface JsonValue {
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 9000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchTextWithRetry(url: string, retries = 2): Promise<string> {
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (error) {
      if (attempt >= retries) {
        console.error("fetchTextWithRetry failed", { url, attempt, error });
        throw error;
      }
      attempt += 1;
      await sleep(350 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function fetchJsonWithRetry<T extends JsonValue>(url: string, retries = 2): Promise<T> {
  const text = await fetchTextWithRetry(url, retries);
  return JSON.parse(text) as T;
}
