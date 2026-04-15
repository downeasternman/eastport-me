import type { AppPayload } from "../types";

interface CacheEntry {
  value: AppPayload;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getMemoryCache(key: string): AppPayload | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.value;
}

export function setMemoryCache(key: string, value: AppPayload, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
