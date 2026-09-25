import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Download,
  ExternalLink,
  Heart,
  ImagePlus,
  Loader2,
  RefreshCw,
  Search,
  Shuffle,
  X,
} from "lucide-react";
import { Button, IconButton, Modal, Segmented, Select, Skeleton } from "@/shared/ui";
import { wallpaperErrorKey } from "./store";
import {
  getTopic,
  searchWallhaven,
  WALLHAVEN_TOPICS,
  type WallhavenResolution,
  type WallhavenSorting,
  type Wallpaper,
} from "./wallhaven";
import "./wallhaven.css";

interface WallhavenModalProps {
  open: boolean;
  onClose: () => void;
  onSelectWallpaper: (wp: Wallpaper) => Promise<void>;
}

const ALL_TOPICS = "all";

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

export function WallhavenModal({ open, onClose, onSelectWallpaper }: WallhavenModalProps) {
  const { t, i18n } = useTranslation();

  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<string>(ALL_TOPICS);
  const [atleast, setAtleast] = useState<WallhavenResolution>("2560x1440");
  const [sorting, setSorting] = useState<WallhavenSorting>("random");
  const [shuffleNonce, setShuffleNonce] = useState(0);

  const [page, setPage] = useState(1);
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // random sorting is only stable across pages when the server's seed is sent back
  const seedRef = useRef<string | undefined>(undefined);
  const requestRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const load = async (pageNum: number) => {
    const reqId = ++requestRef.current;
    setLoading(true);
    setError(null);
    const tp = query ? undefined : getTopic(topic);
    try {
      const res = await searchWallhaven({
        q: query || tp?.q,
        categories: tp?.categories ?? "110",
        sorting,
        atleast,
        ratios: "landscape",
        page: pageNum,
        seed: pageNum > 1 ? seedRef.current : undefined,
      });
      if (reqId !== requestRef.current) return;
      seedRef.current = res.meta.seed ?? undefined;
      setWallpapers(res.data);
      setTotalItems(res.meta.total);
      setTotalPages(Math.max(1, res.meta.last_page));
      setPage(res.meta.current_page || pageNum);
      scrollRef.current?.scrollTo({ top: 0 });
    } catch {
      if (reqId === requestRef.current) setError(t("wallpaper.wallhavenFetchError"));
    } finally {
      if (reqId === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, topic, atleast, sorting, shuffleNonce]);

  useEffect(() => {
    if (!open) setApplyError(null);
  }, [open]);

  const submitSearch = () => setQuery(draft.trim());

  const handleApply = async (wp: Wallpaper) => {
    setApplyingId(wp.id);
    setApplyError(null);
    try {
      await onSelectWallpaper(wp);
      setAppliedId(wp.id);
      window.setTimeout(() => {
        setAppliedId(null);
        onClose();
      }, 900);
    } catch (err) {
      console.error("Failed to apply wallpaper:", err);
      setApplyError(t(wallpaperErrorKey(err)));
    } finally {
      setApplyingId(null);
    }
  };

  const handleDownload = (wp: Wallpaper) => {
    const a = document.createElement("a");
    a.href = wp.path;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.download = wp.path.split("/").pop() ?? `wallhaven-${wp.id}`;
    a.click();
  };

  const locale = i18n.language?.startsWith("vi") ? "vi-VN" : "en-US";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("wallpaper.wallhavenTitle")}
      width="min(94vw, 1120px)"
    >
      <div className="wh">
        <div className="wh-toolbar">
          <form
            className="wh-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch();
            }}
          >
            <Search size={15} className="wh-search__icon" aria-hidden />
            <input
              className="wh-search__input"
              placeholder={t("wallpaper.wallhavenSearchPlaceholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={t("wallpaper.wallhavenSearch")}
            />
            {draft && (
              <button
                type="button"
                className="wh-search__clear"
                aria-label={t("wallpaper.wallhavenClear")}
                title={t("wallpaper.wallhavenClear")}
                onClick={() => {
                  setDraft("");
                  setQuery("");
                }}
              >
                <X size={14} />
              </button>
            )}
            <Button type="submit" size="sm" variant="primary" className="wh-search__btn">
              {t("wallpaper.wallhavenSearch")}
            </Button>
          </form>

          <div className="wh-toolbar__group">
            <Segmented
              value={atleast}
              onChange={(v) => setAtleast(v as WallhavenResolution)}
              options={[
                { value: "2560x1440", label: t("wallpaper.res2k") },
                { value: "3840x2160", label: t("wallpaper.res4k") },
              ]}
            />
            <div className="wh-sort">
              <Select
                value={sorting}
                onChange={(v) => setSorting(v as WallhavenSorting)}
                options={[
                  { value: "random", label: t("wallpaper.sortRandom") },
                  { value: "toplist", label: t("wallpaper.sortToplist") },
                  { value: "favorites", label: t("wallpaper.sortFavorites") },
                  { value: "views", label: t("wallpaper.sortViews") },
                  { value: "date_added", label: t("wallpaper.sortDateAdded") },
                  { value: "relevance", label: t("wallpaper.sortRelevance") },
                ]}
              />
            </div>
            <IconButton
              label={t("wallpaper.wallhavenShuffle")}
              className="wh-shuffle"
              onClick={() => {
                setSorting("random");
                setShuffleNonce((n) => n + 1);
              }}
            >
              <Shuffle size={16} />
            </IconButton>
          </div>
        </div>

        <div className="wh-topics" role="tablist" aria-label={t("wallpaper.wallhavenTopics")}>
          {[{ id: ALL_TOPICS, icon: "✨" }, ...WALLHAVEN_TOPICS].map((tp) => {
            const active = !query && topic === tp.id;
            return (
              <button
                key={tp.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`wh-topic ${active ? "wh-topic--active" : ""}`}
                onClick={() => {
                  setTopic(tp.id);
                  setDraft("");
                  setQuery("");
                }}
              >
                <span aria-hidden>{tp.icon}</span>
                {tp.id === ALL_TOPICS ? t("wallpaper.wallhavenAllTopics") : t(`wallpaper.topics.${tp.id}`)}
              </button>
            );
          })}
        </div>

        {applyError && (
          <div className="wh-alert" role="alert">
            <AlertCircle size={15} />
            <span>{applyError}</span>
            <button
              type="button"
              className="wh-alert__close"
              aria-label={t("common.close")}
              onClick={() => setApplyError(null)}
            >
              <X size={13} />
            </button>
          </div>
        )}

        <div className="wh-scroll" ref={scrollRef}>
          {loading && wallpapers.length === 0 ? (
            <div className="wh-grid">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="wh-skeleton" radius="var(--radius-md)" />
              ))}
            </div>
          ) : error ? (
            <div className="wh-state">
              <AlertCircle size={32} />
              <p className="wh-state__title">{error}</p>
              <Button variant="primary" size="sm" onClick={() => void load(page)}>
                <RefreshCw size={14} />
                {t("common.retry")}
              </Button>
            </div>
          ) : wallpapers.length === 0 ? (
            <div className="wh-state">
              <Compass size={32} />
              <p className="wh-state__title">{t("wallpaper.wallhavenNoResults")}</p>
              <p>{t("wallpaper.wallhavenTryAnother")}</p>
            </div>
          ) : (
            <div className={`wh-grid ${loading ? "wh-grid--loading" : ""}`}>
              {wallpapers.map((wp) => {
                const is4K = wp.dimension_x >= 3840 || wp.dimension_y >= 2160;
                const isApplying = applyingId === wp.id;
                const isApplied = appliedId === wp.id;
                return (
                  <figure key={wp.id} className="wh-card">
                    <img src={wp.thumbs.large} alt="" className="wh-card__img" loading="lazy" />
                    {wp.colors.length > 0 && (
                      <span className="wh-card__swatches" aria-hidden>
                        {wp.colors.slice(0, 4).map((c) => (
                          <i key={c} style={{ background: c }} />
                        ))}
                      </span>
                    )}
                    <figcaption className="wh-card__meta">
                      <span className="wh-card__res">
                        {is4K && <b>4K</b>}
                        {wp.resolution}
                      </span>
                      <span
                        className="wh-card__fav"
                        title={t("wallpaper.wallhavenFavorites", {
                          n: wp.favorites.toLocaleString(locale),
                        })}
                      >
                        <Heart size={11} />
                        {compact(wp.favorites)}
                      </span>
                    </figcaption>
                    <div className="wh-card__overlay">
                      <Button
                        size="sm"
                        variant="primary"
                        className="wh-card__apply"
                        disabled={isApplying || !!applyingId}
                        onClick={() => void handleApply(wp)}
                      >
                        {isApplying ? (
                          <Loader2 size={14} className="wh-spin" />
                        ) : isApplied ? (
                          <Check size={14} />
                        ) : (
                          <ImagePlus size={14} />
                        )}
                        {isApplying
                          ? t("wallpaper.wallhavenApplying")
                          : isApplied
                            ? t("wallpaper.wallhavenApplied")
                            : t("wallpaper.wallhavenSetAs")}
                      </Button>
                      <div className="wh-card__tools">
                        <IconButton
                          label={t("wallpaper.wallhavenDownloadOrig")}
                          onClick={() => handleDownload(wp)}
                        >
                          <Download size={14} />
                        </IconButton>
                        <IconButton
                          label={t("wallpaper.wallhavenOpenWeb")}
                          onClick={() => window.open(wp.url, "_blank", "noreferrer")}
                        >
                          <ExternalLink size={14} />
                        </IconButton>
                      </div>
                    </div>
                  </figure>
                );
              })}
            </div>
          )}
        </div>

        <div className="wh-footer">
          <span className="wh-footer__count">
            {totalItems > 0 &&
              t("wallpaper.wallhavenItemsCount", {
                total: totalItems.toLocaleString(locale),
                page,
                pages: totalPages,
              })}
          </span>
          <div className="wh-pager">
            <IconButton
              label={t("wallpaper.wallhavenPrev")}
              disabled={page <= 1 || loading}
              onClick={() => void load(page - 1)}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <span className="wh-pager__num">
              {page} / {totalPages}
            </span>
            <IconButton
              label={t("wallpaper.wallhavenNext")}
              disabled={page >= totalPages || loading}
              onClick={() => void load(page + 1)}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
