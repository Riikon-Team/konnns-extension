import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/core/settings-engine/settingsStore";
import { WALLPAPER_FEATURE_ID } from "./id";
import { useWallpaperStore, wallpaperExists } from "./store";
import { fetchRandomWallhavenWallpaper, wallhavenOptionsFrom } from "./wallhaven";

/** quiet period after a Wallhaven setting changes before fetching / pruning */
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

/**
 * Wallhaven random-on-open. Reuses the last downloaded image until the refresh
 * interval runs out (or the topics change) instead of downloading a new
 * multi-MB file on every tab, and caps how many auto images are kept.
 * Returns the id to show (null = use the stored last pick).
 */
export function useWallhavenRandom({
  enabled,
  hydrated,
  signature,
  keep,
}: {
  enabled: boolean;
  hydrated: boolean;
  signature: string;
  keep: number;
}): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  // signature last handled — refs survive StrictMode's remount, so this also dedupes that
  const sigRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hydrated || !enabled) return;
    if (sigRef.current === signature) return;
    // First run on tab open: go now. Later runs come from the user editing
    // settings — wait for them to settle so a burst of edits costs one download.
    const firstRun = sigRef.current === null;
    const timer = window.setTimeout(
      () => {
        sigRef.current = signature;
        void run();
      },
      firstRun ? 0 : WALLHAVEN_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);

    async function run() {
      const settings = useSettingsStore.getState();
      const current = settings.values[WALLPAPER_FEATURE_ID] ?? {};
      const opts = wallhavenOptionsFrom(current);
      const lastId = typeof current.wallhavenLastId === "string" ? current.wallhavenLastId : "";
      const lastAt = typeof current.wallhavenLastAt === "number" ? current.wallhavenLastAt : 0;
      // (the previous pick is already on screen via `wallhavenLastId` while this runs)
      const lastUsable = !!lastId && (await wallpaperExists(lastId));
      const fresh =
        lastUsable &&
        current.wallhavenLastSig === opts.signature &&
        opts.refreshMs > 0 &&
        Date.now() - lastAt < opts.refreshMs;
      if (fresh) return;

      try {
        const wp = await fetchRandomWallhavenWallpaper(opts);
        if (!wp) return;
        const newId = await useWallpaperStore.getState().addFromUrl(wp.path, { auto: true });
        setActiveId(newId);
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
  }, [hydrated, enabled, signature]);

  // Also prune when the limit is lowered, and once at tab open (older images).
  // Debounced: deletion is permanent, and dragging the slider past 1 on the way
  // to 5 must not wipe images. Cancelling only postpones — the next tab prunes.
  useEffect(() => {
    if (!hydrated || !enabled) return;
    const timer = window.setTimeout(() => {
      void pruneWallhaven().catch((err) => console.warn("Wallhaven prune failed:", err));
    }, WALLHAVEN_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [hydrated, enabled, keep]);

  return activeId;
}
