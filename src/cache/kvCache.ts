import type { AppPayload } from "../types";
import { getMemoryCache, setMemoryCache } from "./memoryCache";

const TTL_MS = 10 * 60 * 1000;
const KEY = "eastport-me:payload";

export function getCachedPayload(): AppPayload | null {
  return getMemoryCache(KEY);
}

export function setCachedPayload(payload: AppPayload): void {
  setMemoryCache(KEY, payload, TTL_MS);
}
