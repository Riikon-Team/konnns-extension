import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { registerFeature } from "@/core/feature-registry";
import { CORE_FEATURE_ID, useFeatureValues, useSettingsStore } from "@/core/settings-engine/settingsStore";
import { getWallpaperUrl, useWallpaperStore, wallpaperExists } from "./store";
import { WallpaperManager } from "./WallpaperManager";
import { wallpaperSettingsSchema } from "./settings.schema";
import { fetchRandomWallhavenWallpaper, wallhavenOptionsFrom } from "./wallhaven";
import "./wallpaper.css";

export const WALLPAPER_FEATURE_ID = "wallpaper";
/** quiet period after a Wallhaven setting changes before fetching a new image */
const WALLHAVEN_SETTLE_MS = 1200;

/**
 * Keep only the newest `wallhavenKeep` auto-downloaded Wallhaven images.
 * Never touches the one on screen, the chosen wallpaper or slideshow picks.
 */
async function pruneWallhaven(): Promise<void> {
  const settings = useSettingsStore.getState();
  const v = settings.values[WALLPAPER_FEATURE_ID] ?? {};
  const keepIds = [
    typeof v.wallhavenLastId === "string" ? v.wallhavenLastId : "",
    typeof v.activeId === "string" ? v.activeId : "",
    ...(Array.isArray(v.slideItems) ? (v.slideItems as string[]) : []),
  ].filter(Boolean);
  const store = useWallpaperStore.getState();
  // Versions before the `auto` flag saved random picks as plain "wallhaven-*"
  // rows. Adopt them once so they count toward the cap too.
  if (v.wallhavenLegacyAdopted !== true) {
    await store.adoptLegacyWallhaven(keepIds);
    settings.setValue(WALLPAPER_FEATURE_ID, "wallhavenLegacyAdopted", true);
  }
  await store.pruneAuto(wallhavenOptionsFrom(v).keep, keepIds);
}

interface Layer {
  key: string;
  url: string;
  type: "image" | "video";
  visible: boolean;
}

/**
 * Background zone renderer. Placeholder = theme gradient shown instantly;
 * the real wallpaper crossfades in once decoded — no white flash, no layout jump
 * (docs/phase-1-mvp/03 §2).
 */
function WallpaperLayer() {
  const values = useFeatureValues(WALLPAPER_FEATURE_ID);
  const coreValues = useFeatureValues(CORE_FEATURE_ID);
  const [layers, setLayers] = useState<Layer[]>([]);
  const urlsRef = useRef<Set<string>>(new Set());
  const touch = useWallpaperStore((s) => s.touch);

  // Slideshow: cycle through the chosen wallpapers on a timer
  const slideshow = values.mode === "slideshow";
  const slideItems = Array.isArray(values.slideItems) ? (values.slideItems as string[]) : [];
  const slideKey = slideItems.join(",");
  const slideInterval =
    typeof values.slideInterval === "number" ? values.slideInterval : 30;
  const slideOrder = (values.slideOrder as string) ?? "sequential";
  const [slideIdx, setSlideIdx] = useState(0);

  useEffect(() => {
    if (!slideshow) return;
    setSlideIdx(0);
    const ids = slideKey ? slideKey.split(",") : [];
    if (ids.length <= 1) return; // nothing to cycle through
    const id = window.setInterval(() => {
      setSlideIdx((i) => {
        if (slideOrder === "random") {
          let n = i;
          while (n === i) n = Math.floor(Math.random() * ids.length);
          return n;
        }
        return (i + 1) % ids.length;
      });
    }, Math.max(5, slideInterval) * 1000);
    return () => window.clearInterval(id);
  }, [slideshow, slideKey, slideInterval, slideOrder]);

  // Random-on-open: pick a random wallpaper from the library or Wallhaven each new tab
  const rawRandomMode = values.randomMode;
  const randomModeKind: "wallhaven" | "off" | "images" | "videos" | "all" =
    rawRandomMode === "wallhaven"
      ? "wallhaven"
      : rawRandomMode === "off"
        ? "off"
        : rawRandomMode === "images" || rawRandomMode === "videos" || rawRandomMode === "all"
          ? rawRandomMode
          : rawRandomMode === false
            ? "off"
            : rawRandomMode === true
              ? "all"
              : "wallhaven";

  const hydrated = useSettingsStore((s) => s.hydrated);
  const { signature: wallhavenSig, keep: wallhavenKeep } = wallhavenOptionsFrom(values);

  const isLocalRandom =
    (randomModeKind === "images" || randomModeKind === "videos" || randomModeKind === "all") &&
    !slideshow;

  const items = useWallpaperStore((s) => s.items);
  const itemsLoaded = useWallpaperStore((s) => s.loaded);
  const loadItems = useWallpaperStore((s) => s.load);
  const [randomId, setRandomId] = useState<string | null>(null);
  const [wallhavenActiveId, setWallhavenActiveId] = useState<string | null>(null);
  // signature last handled — refs survive StrictMode's remount, so this also dedupes that
  const wallhavenSigRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLocalRandom && !itemsLoaded) void loadItems();
  }, [isLocalRandom, itemsLoaded, loadItems]);

  useEffect(() => {
    if (isLocalRandom && itemsLoaded && items.length > 0) {
      const pool =
        randomModeKind === "all"
          ? items
          : items.filter((i) => (randomModeKind === "images" ? i.type === "image" : i.type === "video"));
      if (pool.length > 0) setRandomId(pool[Math.floor(Math.random() * pool.length)].id);
    }
    // pick once when random mode turns on / library first loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocalRandom, randomModeKind, itemsLoaded]);

  // Wallhaven random-on-open. Reuses the last downloaded image until the refresh
  // interval runs out (or the topics change) instead of downloading a new
  // multi-MB file on every single tab.
  useEffect(() => {
    if (!hydrated || slideshow || randomModeKind !== "wallhaven") return;
    if (wallhavenSigRef.current === wallhavenSig) return;
    // First run on tab open: go now. Later runs come from the user editing
    // settings (ticking topics, picking resolution…) — wait for them to settle
    // so a burst of edits costs one download, not one per click.
    const firstRun = wallhavenSigRef.current === null;
    const timer = window.setTimeout(
      () => {
        wallhavenSigRef.current = wallhavenSig;
        void runWallhaven();
      },
      firstRun ? 0 : WALLHAVEN_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);

    async function runWallhaven() {
      const settings = useSettingsStore.getState();
      const current = settings.values[WALLPAPER_FEATURE_ID] ?? {};
      const opts = wallhavenOptionsFrom(current);
      const lastId = typeof current.wallhavenLastId === "string" ? current.wallhavenLastId : "";
      const lastAt = typeof current.wallhavenLastAt === "number" ? current.wallhavenLastAt : 0;
      const lastSig = current.wallhavenLastSig;
      // (the previous pick is already on screen via `wallhavenLastId` while this runs)
      const lastUsable = !!lastId && (await wallpaperExists(lastId));
      const fresh =
        lastUsable &&
        lastSig === opts.signature &&
        opts.refreshMs > 0 &&
        Date.now() - lastAt < opts.refreshMs;
      if (fresh) return;

      try {
        const wp = await fetchRandomWallhavenWallpaper(opts);
        if (!wp) return;
        const store = useWallpaperStore.getState();
        const newId = await store.addFromUrl(wp.path, { auto: true });
        setWallhavenActiveId(newId);
        settings.setValues(WALLPAPER_FEATURE_ID, {
          wallhavenLastId: newId,
          wallhavenLastAt: Date.now(),
          wallhavenLastSig: opts.signature,
        });
        await pruneWallhaven();
      } catch (err) {
        console.warn("Failed to fetch random Wallhaven wallpaper:", err);
      }
    }
  }, [hydrated, slideshow, randomModeKind, wallhavenSig]);

  // Cap the auto-downloaded Wallhaven images — also when the limit is lowered,
  // and once at tab open for images saved by older versions.
  // Debounced: deletion is permanent, and dragging the slider past 1 on the way
  // to 5 must not wipe images. Cancelling here only postpones — the next tab
  // open prunes anyway.
  useEffect(() => {
    if (!hydrated || randomModeKind !== "wallhaven") return;
    const timer = window.setTimeout(() => {
      void pruneWallhaven().catch((err) => console.warn("Wallhaven prune failed:", err));
    }, WALLHAVEN_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [hydrated, randomModeKind, wallhavenKeep]);

  const slideActiveId =
    slideshow && slideItems.length > 0
      ? slideItems[Math.min(slideIdx, slideItems.length - 1)]
      : null;
  const activeId =
    slideActiveId ??
    (randomModeKind === "wallhaven"
      ? (wallhavenActiveId ??
        (values.wallhavenLastId as string | undefined) ??
        (values.activeId as string) ??
        "")
      : isLocalRandom && randomId
        ? randomId
        : ((values.activeId as string) ?? ""));
  const lowPower =
    coreValues.lowPower === true ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const parallaxOn = coreValues.parallax === true && !lowPower;
  const layerRef = useRef<HTMLDivElement>(null);

  // parallax: shift the wallpaper slightly opposite the pointer (docs request, optional)
  useEffect(() => {
    if (!parallaxOn) {
      layerRef.current?.style.removeProperty("--parallax-x");
      layerRef.current?.style.removeProperty("--parallax-y");
      return;
    }
    const onMove = (e: MouseEvent) => {
      const cx = (e.clientX / window.innerWidth - 0.5) * 2;
      const cy = (e.clientY / window.innerHeight - 0.5) * 2;
      const max = 14;
      layerRef.current?.style.setProperty("--parallax-x", `${(-cx * max).toFixed(1)}px`);
      layerRef.current?.style.setProperty("--parallax-y", `${(-cy * max).toFixed(1)}px`);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [parallaxOn]);

  const videoSound = values.videoSound === true;
  const videoVolume = typeof values.videoVolume === "number" ? values.videoVolume : 50;
  const pauseWhenHidden = values.pauseWhenHidden !== false;
  const videoEls = useRef<Set<HTMLVideoElement>>(new Set());

  // apply audio settings to a video element (muted needs to be a property, not attr)
  const applyAudio = useCallback(
    (el: HTMLVideoElement) => {
      el.muted = !videoSound;
      el.volume = Math.min(1, Math.max(0, videoVolume / 100));
    },
    [videoSound, videoVolume],
  );

  const registerVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) {
        videoEls.current.add(el);
        applyAudio(el);
      }
    },
    [applyAudio],
  );

  // periodically prune detached video elements from the tracking set
  useEffect(() => {
    const set = videoEls.current;
    const id = window.setInterval(() => {
      set.forEach((el) => {
        if (!el.isConnected) set.delete(el);
      });
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  // re-apply audio when the sliders/toggles change
  useEffect(() => {
    videoEls.current.forEach(applyAudio);
  }, [applyAudio]);

  // pause video while the tab is hidden; resume when it becomes visible again
  // (docs: video only plays on the active NewTab — saves CPU/battery/sound)
  useEffect(() => {
    if (!pauseWhenHidden) return;
    const sync = () => {
      videoEls.current.forEach((el) => {
        if (document.hidden) el.pause();
        else void el.play().catch(() => {});
      });
    };
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => document.removeEventListener("visibilitychange", sync);
  }, [pauseWhenHidden, layers]);

  useEffect(() => {
    let cancelled = false;

    if (!activeId) {
      setLayers((prev) => prev.map((l) => ({ ...l, visible: false })));
      return;
    }

    void (async () => {
      const res = await getWallpaperUrl(activeId);
      if (!res || cancelled) return;

      // low-power mode: never play video wallpapers, keep gradient instead
      if (res.type === "video" && lowPower) {
        URL.revokeObjectURL(res.url);
        setLayers((prev) => prev.map((l) => ({ ...l, visible: false })));
        return;
      }

      if (res.type === "image") {
        // decode before showing so the crossfade lands on a complete image
        const img = new Image();
        img.src = res.url;
        try {
          await img.decode();
        } catch {
          /* still show — decode() may reject for exotic formats */
        }
        if (cancelled) {
          URL.revokeObjectURL(res.url);
          return;
        }
      }

      urlsRef.current.add(res.url);
      void touch(activeId);
      const key = `${activeId}-${Date.now()}`;
      setLayers((prev) => [...prev.filter((l) => l.visible), { key, url: res.url, type: res.type, visible: false }]);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return;
          setLayers((prev) =>
            prev.map((l) => (l.key === key ? { ...l, visible: true } : { ...l, visible: false })),
          );
        }),
      );
      // drop fully faded-out layers after the transition
      window.setTimeout(() => {
        if (cancelled) return;
        setLayers((prev) => {
          for (const l of prev) {
            if (!l.visible && l.key !== key) {
              URL.revokeObjectURL(l.url);
              urlsRef.current.delete(l.url);
            }
          }
          return prev.filter((l) => l.visible || l.key === key);
        });
      }, 700);

      // Immediately pause old video layers so they don't keep playing audio
      // while crossfading out (race condition fix for slideshow / quick switch).
      requestAnimationFrame(() => {
        if (cancelled) return;
        const container = layerRef.current;
        if (!container) return;
        container
          .querySelectorAll<HTMLVideoElement>("video[data-visible='false']")
          .forEach((v) => {
            v.pause();
          });
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeId, lowPower, touch]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  return (
    <div
      ref={layerRef}
      className={`wallpaper-layer ${parallaxOn ? "wallpaper-layer--parallax" : ""}`}
      aria-hidden
    >
      {layers.map((l) =>
        l.type === "video" ? (
          <video
            key={l.key}
            ref={registerVideo}
            className={`wallpaper-layer__media ${l.visible ? "wallpaper-layer__media--visible" : ""}`}
            src={l.url}
            autoPlay
            loop
            playsInline
            data-visible={l.visible}
          />
        ) : (
          <img
            key={l.key}
            className={`wallpaper-layer__media ${l.visible ? "wallpaper-layer__media--visible" : ""}`}
            src={l.url}
            alt=""
          />
        ),
      )}
    </div>
  );
}

registerFeature({
  id: WALLPAPER_FEATURE_ID,
  zone: "background",
  nameKey: "features.wallpaper",
  icon: ImageIcon,
  defaultEnabled: true,
  settingsSchema: wallpaperSettingsSchema,
  component: WallpaperLayer,
  settingsExtra: WallpaperManager,
  order: 0,
});

export default WallpaperLayer;
