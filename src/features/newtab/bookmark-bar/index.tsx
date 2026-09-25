import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerFeature } from "@/core/feature-registry";
import { useFeatureValues, useSettingsStore } from "@/core/settings-engine/settingsStore";
import { Button, Skeleton } from "@/shared/ui";
import {
  getBookmarkBarItems,
  hasBookmarkPermission,
  requestBookmarkPermission,
  type BookmarkItem,
} from "./bookmarks-api";
import { Favicon, FolderButton } from "./FolderButton";
import { bookmarkSettingsSchema } from "./settings.schema";
import "./bookmark-bar.css";

export const BOOKMARK_FEATURE_ID = "bookmark-bar";

function BookmarkBar() {
  const { t } = useTranslation();
  const values = useFeatureValues(BOOKMARK_FEATURE_ID);
  const setValue = useSettingsStore((s) => s.setValue);
  const [state, setState] = useState<"checking" | "no-permission" | "loading" | "ready">("checking");
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const orientation = (values.orientation as string) ?? "horizontal";
  const showMode = (values.showMode as string) ?? "always";
  const seenNote = values.seenFirstTimeNote === true;

  const load = useCallback(async () => {
    setState("loading");
    try {
      setItems(await getBookmarkBarItems());
      setState("ready");
    } catch {
      setState("no-permission");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      if (await hasBookmarkPermission()) void load();
      else setState("no-permission");
    })();
  }, [load]);

  const vertical = orientation === "vertical";
  const hoverScroll = values.hoverScroll !== false;

  // macOS-dock magnification (kept as a function: the hover-scroll loop re-runs
  // it every frame, since items slide under a still pointer while scrolling)
  const applyMagnify = useCallback(
    (clientX: number, clientY: number) => {
      const bar = barRef.current;
      if (!bar) return;
      const nodes = bar.querySelectorAll<HTMLElement>(".bookmark-item");

      // Radial: find the single closest item and magnify only that one
      if (orientation === "radial") {
        let best: { el: HTMLElement; dist: number } | null = null;
        nodes.forEach((node) => {
          const r = node.getBoundingClientRect();
          const dist = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
          if (!best || dist < best.dist) best = { el: node, dist };
        });
        nodes.forEach((node) => {
          node.style.setProperty("--bm-scale", node === best?.el ? "1.4" : "1");
        });
        return;
      }

      // Horizontal / vertical: proximity-based scaling along the bar axis
      nodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        const center = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
        const pos = vertical ? clientY : clientX;
        const scale = Math.max(1, 1.35 - Math.abs(pos - center) / 140);
        node.style.setProperty("--bm-scale", scale.toFixed(3));
      });
    },
    [orientation, vertical],
  );

  /* ---------------- hover-to-scroll ---------------- */
  // px/s at the very edge (and while hovering an arrow)
  const MAX_SPEED = 720;
  // edge band (px) inside the track where hovering scrolls
  const EDGE = 72;
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** -1..1: set by hovering an arrow button (overrides the edge bands) */
  const arrowPush = useRef(0);
  const raf = useRef(0);

  const updateScrollState = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const pos = vertical ? el.scrollTop : el.scrollLeft;
    const max = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    setCanScrollLeft(pos > 1);
    setCanScrollRight(pos < max - 1);
  }, [vertical]);

  /** Scroll velocity (px/s) from the pointer: stronger the closer to an edge. */
  const velocity = useCallback((): number => {
    if (arrowPush.current) return arrowPush.current * MAX_SPEED;
    const el = trackRef.current;
    const p = pointer.current;
    if (!el || !p || !hoverScroll) return 0;
    const r = el.getBoundingClientRect();
    const pos = vertical ? p.y - r.top : p.x - r.left;
    const size = vertical ? r.height : r.width;
    if (pos < 0 || pos > size) return 0;
    const band = Math.min(EDGE, size / 4);
    if (pos < band) return -MAX_SPEED * (1 - pos / band) ** 2;
    if (pos > size - band) return MAX_SPEED * (1 - (size - pos) / band) ** 2;
    return 0;
  }, [hoverScroll, vertical]);

  /** One rAF loop while the pointer is over the bar; idles cheaply mid-track. */
  const startLoop = useCallback(() => {
    if (raf.current) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const el = trackRef.current;
      const v = velocity();
      if (el && v !== 0) {
        if (vertical) el.scrollTop += v * dt;
        else el.scrollLeft += v * dt;
        updateScrollState();
        const p = pointer.current;
        if (p) applyMagnify(p.x, p.y); // items moved under the pointer
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [velocity, vertical, updateScrollState, applyMagnify]);

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  useEffect(() => stopLoop, [stopLoop]);

  const onMouseMove = (e: React.MouseEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    applyMagnify(e.clientX, e.clientY);
    if (orientation !== "radial") startLoop();
  };
  const onMouseLeave = () => {
    pointer.current = null;
    arrowPush.current = 0;
    stopLoop();
    barRef.current
      ?.querySelectorAll<HTMLElement>(".bookmark-item")
      .forEach((n) => n.style.removeProperty("--bm-scale"));
  };

  useEffect(() => {
    updateScrollState();
    const onResize = () => updateScrollState();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [items, updateScrollState]);

  // wheel over the bar scrolls ALONG it (a plain vertical wheel moves a
  // horizontal bar). Non-passive so the page itself doesn't also react.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const max = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
      if (max <= 0 || delta === 0) return;
      e.preventDefault();
      if (vertical) el.scrollTop += delta;
      else el.scrollLeft += delta;
      updateScrollState();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // seenNote/state: the track only mounts once loaded and the first-run note is dismissed
  }, [items, vertical, updateScrollState, seenNote, state]);

  const scrollTrack = (direction: "left" | "right") => {
    const el = trackRef.current;
    if (!el) return;
    const step = direction === "right" ? 200 : -200; // px per click
    el.scrollBy(vertical ? { top: step, behavior: "smooth" } : { left: step, behavior: "smooth" });
  };

  /** hovering an arrow keeps scrolling that way (clicking still steps) */
  const arrowHover = (dir: -1 | 0 | 1) => () => {
    arrowPush.current = hoverScroll ? dir : 0;
    if (dir !== 0) startLoop();
  };

  const isTop = orientation === "horizontal-top";
  const barClass = [
    "bookmark-bar",
    orientation === "vertical" && "bookmark-bar--vertical",
    isTop && "bookmark-bar--top",
    showMode === "hover" && "bookmark-bar--hover-mode",
  ]
    .filter(Boolean)
    .join(" ");

  const renderItem = (item: BookmarkItem, key?: string) =>
    item.url ? (
      <a key={key} className="bookmark-item" href={item.url} title={item.title}>
        <Favicon url={item.url} title={item.title} />
        <span className="bookmark-item__label">{item.title || item.url}</span>
      </a>
    ) : (
      <FolderButton key={key} item={item} dir={isTop ? "down" : "up"} />
    );

  if (state === "no-permission") {
    return (
      <div className="bookmark-bar">
        <div className="bookmark-note">
          <span>{t("bookmarks.permissionNeeded")}</span>
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              if (await requestBookmarkPermission()) void load();
            }}
          >
            {t("bookmarks.grant")}
          </Button>
        </div>
      </div>
    );
  }

  if (state === "checking" || state === "loading") {
    // dot skeletons matching final size — no layout shift when data arrives
    return (
      <div className="bookmark-bar" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} width={52} height={48} radius="var(--radius-sm)" />
        ))}
      </div>
    );
  }

  const noteBlock = !seenNote ? (
    <div className="bookmark-note">
      <span>{t("bookmarks.firstTimeNote")}</span>
      <Button size="sm" onClick={() => setValue(BOOKMARK_FEATURE_ID, "seenFirstTimeNote", true)}>
        {t("bookmarks.gotIt")}
      </Button>
    </div>
  ) : null;

  if (orientation === "radial" && seenNote && items.length > 0) {
    const n = items.length;
    const ringCfg = [
      { capacity: 12, scale: 1.0 },
      { capacity: 8, scale: 0.5 },
      { capacity: 16, scale: 0.15 },
    ];
    const baseR = Math.min(130, 70 + n * 5);

    let rem = n;
    const activeRings: { count: number; rx: number; ry: number }[] = [];
    for (const r of ringCfg) {
      if (rem <= 0) break;
      const count = Math.min(rem, r.capacity);
      const radius = baseR * r.scale;
      activeRings.push({ count, rx: radius * 2, ry: radius * 0.6 });
      rem -= count;
    }
    if (rem > 0 && activeRings.length > 0) activeRings[activeRings.length - 1].count += rem;

    const outer = activeRings[0];
    const cW = (outer?.rx ?? 100) + 56;
    const cH = (outer?.ry ?? 50) + 56;
    const yBase = 16; 

    return (
      <div
        ref={barRef}
        className={`bookmark-radial ${showMode === "hover" ? "bookmark-bar--hover-mode" : ""}`}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{ width: cW * 2, height: cH * 2 + 40 }}
      >
        {activeRings.map((ring, ri) => {
          const startIdx = activeRings.slice(0, ri).reduce((s, r) => s + r.count, 0);
          return items.slice(startIdx, startIdx + ring.count).map((item, i) => {
            const angle = ring.count === 1 ? 0 : -80 + (i / (ring.count - 1)) * 160;
            const rad = (angle * Math.PI) / 180;
            const x = Math.sin(rad) * ring.rx;
            const y = -Math.cos(rad) * ring.ry + yBase;
            return (
              <div
                className="bookmark-radial__slot"
                key={item.id}
                style={{
                  transform: `translate(calc(-50% + ${x.toFixed(1)}px), calc(180% + ${y.toFixed(1)}px))`,
                }}
              >
                {renderItem(item)}
              </div>
            );
          });
        })}
      </div>
    );
  }

  const hasItems = seenNote && items.length > 0;

  return (
    <div ref={barRef} className={barClass} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
      {noteBlock}
      {seenNote && items.length === 0 && (
        <span className="bookmark-note">{t("bookmarks.empty")}</span>
      )}
      {hasItems && (
        <>
          <button
            className={`bookmark-bar__scroll-btn ${canScrollLeft ? "bookmark-bar__scroll-btn--visible" : ""}`}
            onClick={() => scrollTrack("left")}
            onMouseEnter={arrowHover(-1)}
            onMouseLeave={arrowHover(0)}
            aria-label={t("bookmarks.scrollBack")}
            tabIndex={canScrollLeft ? 0 : -1}
          >
            {vertical ? <ChevronUp size={18} /> : <ChevronLeft size={18} />}
          </button>
          <div
            className={[
              "bookmark-bar__track",
              canScrollLeft && "bookmark-bar__track--fade-start",
              canScrollRight && "bookmark-bar__track--fade-end",
            ]
              .filter(Boolean)
              .join(" ")}
            ref={trackRef}
            onScroll={updateScrollState}
          >
            {items.map((item) => renderItem(item, item.id))}
          </div>
          <button
            className={`bookmark-bar__scroll-btn ${canScrollRight ? "bookmark-bar__scroll-btn--visible" : ""}`}
            onClick={() => scrollTrack("right")}
            onMouseEnter={arrowHover(1)}
            onMouseLeave={arrowHover(0)}
            aria-label={t("bookmarks.scrollForward")}
            tabIndex={canScrollRight ? 0 : -1}
          >
            {vertical ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        </>
      )}
    </div>
  );
}

registerFeature({
  id: BOOKMARK_FEATURE_ID,
  zone: "quick-access-bar",
  nameKey: "features.bookmark-bar",
  icon: Bookmark,
  defaultEnabled: true,
  settingsSchema: bookmarkSettingsSchema,
  component: BookmarkBar,
  order: 3,
});

export default BookmarkBar;
