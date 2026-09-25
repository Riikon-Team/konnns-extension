import { hasPermissions, requestPermissions } from "@/core/permissions";
import type { SuggestProviderId } from "./engines";

/**
 * Search-as-you-type suggestions from the engines' public OpenSearch
 * endpoints. They send no CORS headers, so the extension needs host access —
 * requested at RUNTIME (optional_host_permissions), never in the manifest:
 * a new install-time host permission makes Chrome disable the extension on
 * update until every user re-approves it.
 *
 * All endpoints answer the OpenSearch shape `[query, [s1, s2, …], …]`.
 */
const PROVIDERS: Record<SuggestProviderId, (q: string) => string> = {
  // ie/oe=utf-8: without them Google may answer in a legacy charset and
  // mangle Vietnamese diacritics
  google: (q) =>
    `https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&q=${encodeURIComponent(q)}`,
  youtube: (q) =>
    `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&ie=utf-8&oe=utf-8&q=${encodeURIComponent(q)}`,
  bing: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(q)}`,
};

export const SUGGEST_ORIGINS = [
  "https://suggestqueries.google.com/*",
  "https://api.bing.com/*",
  "https://duckduckgo.com/*",
];

export function hasSuggestPermission(): Promise<boolean> {
  return hasPermissions({ origins: SUGGEST_ORIGINS });
}

/** Must be called straight from a click handler (user gesture). */
export function requestSuggestPermission(): Promise<boolean> {
  return requestPermissions({ origins: SUGGEST_ORIGINS });
}

export async function fetchSuggestions(
  provider: SuggestProviderId,
  query: string,
  signal?: AbortSignal,
  limit = 8,
): Promise<string[]> {
  const res = await fetch(PROVIDERS[provider](query), { signal, credentials: "omit" });
  if (!res.ok) throw new Error(`suggest http ${res.status}`);
  const data: unknown = await res.json();
  const list = Array.isArray(data) && Array.isArray(data[1]) ? (data[1] as unknown[]) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const s = typeof item === "string" ? item.trim() : "";
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
