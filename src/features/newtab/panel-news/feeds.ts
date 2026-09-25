import { CURATED_FEEDS, TOPICS } from "./rss";
import type { Feed } from "./store";

/**
 * Settings → concrete feed list + cache key. Shared by the panel and the
 * bubble so both hit the SAME swr cache entry (one fetch serves both).
 */
export function resolveNewsFeeds(values: Record<string, unknown>): { feeds: Feed[]; cacheKey: string } {
  const mode = (values.mode as string) ?? "topics";
  if (mode === "rss") {
    const feedIds = (values.feeds as string[]) ?? ["techcrunch", "vne-news"];
    return {
      feeds: CURATED_FEEDS.filter((f) => feedIds.includes(f.id)).map((f) => ({ url: f.url, source: f.source })),
      cacheKey: "rss:" + [...feedIds].sort().join(","),
    };
  }
  const topics = (values.topics as string[]) ?? ["tech"];
  return {
    feeds: TOPICS.filter((tp) => topics.includes(tp.id)).flatMap((tp) => tp.feeds),
    cacheKey: "topics:" + [...topics].sort().join(","),
  };
}
