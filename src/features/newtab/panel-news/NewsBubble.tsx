import { useEffect, useState } from "react";
import { Newspaper, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFeatureValues } from "@/core/settings-engine/settingsStore";
import { useLeftSidebar } from "@/core/layout-engine/leftSidebar";
import { useNewsStore } from "./store";
import { hasHostPermission, type NewsArticle } from "./rss";
import { resolveNewsFeeds } from "./feeds";
import { NEWS_FEATURE_ID } from "./NewsSettings";

const BUBBLE_COUNT = 3;

/** 3 random stories from today (falls back to the newest when today is thin). */
function pickStories(articles: NewsArticle[]): NewsArticle[] {
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const today = articles.filter((a) => a.publishedAt >= startOfDay);
  const pool = today.length >= BUBBLE_COUNT ? today : [...articles].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 12);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, BUBBLE_COUNT);
}

/**
 * Small "today's news" card, bottom-left. Reads the same cached feed as the
 * panel (swr: a cached list shows instantly, no extra download while fresh).
 * Steps aside while a left panel is open so the two never overlap.
 */
export function NewsBubble() {
  const { t } = useTranslation();
  const values = useFeatureValues(NEWS_FEATURE_ID);
  const panelOpen = useLeftSidebar((s) => s.open.length > 0);
  const articles = useNewsStore((s) => s.articles);
  const fetch = useNewsStore((s) => s.fetch);
  const [stories, setStories] = useState<NewsArticle[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const enabled = values.bubble !== false;
  const { feeds, cacheKey } = resolveNewsFeeds(values);

  useEffect(() => {
    if (!enabled || feeds.length === 0) return;
    void hasHostPermission().then((ok) => {
      if (ok) void fetch(feeds, cacheKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey]);

  // pick once per new tab, when the list first arrives — not on every refresh
  useEffect(() => {
    if (stories === null && articles.length > 0) setStories(pickStories(articles));
  }, [articles, stories]);

  if (!enabled || dismissed || !stories || stories.length === 0) return null;

  return (
    <aside
      className={`news-bubble ${panelOpen ? "news-bubble--hidden" : ""}`}
      aria-label={t("news.bubbleTitle")}
      aria-hidden={panelOpen}
    >
      <div className="news-bubble__head">
        <Newspaper size={13} aria-hidden />
        <span>{t("news.bubbleTitle")}</span>
        <button
          type="button"
          className="news-bubble__close"
          aria-label={t("common.close")}
          title={t("common.close")}
          tabIndex={panelOpen ? -1 : 0}
          onClick={() => setDismissed(true)}
        >
          <X size={12} />
        </button>
      </div>
      {stories.map((a) => (
        <a
          key={a.id}
          className="news-bubble__item"
          href={a.link}
          target="_blank"
          rel="noreferrer noopener"
          tabIndex={panelOpen ? -1 : 0}
        >
          <span className="news-bubble__title">{a.title}</span>
          <span className="news-bubble__source">{a.source}</span>
        </a>
      ))}
    </aside>
  );
}
