import { create } from "zustand";
import { db, type WallpaperRow } from "@/core/storage/db";
import { emit } from "@/core/event-bus";
import {
  fetchImageFromUrl,
  MAX_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  processImage,
} from "./image";

export interface WallpaperMeta {
  id: string;
  type: "image" | "video";
  name: string;
  size: number;
  createdAt: number;
  lastUsedAt: number;
  auto?: boolean;
}

interface WallpaperState {
  loaded: boolean;
  items: WallpaperMeta[];
  load: () => Promise<void>;
  addImageFile: (file: File) => Promise<string>;
  addVideoFile: (file: File) => Promise<string>;
  addFromUrl: (url: string, opts?: { auto?: boolean }) => Promise<string>;
  remove: (id: string) => Promise<void>;
  touch: (id: string) => Promise<void>;
  /** delete wallpapers not used in the last 30 days (quick cleanup) */
  cleanup: (keepIds: string[]) => Promise<number>;
  /** keep only the `keep` newest auto-downloaded wallpapers (plus `keepIds`) */
  pruneAuto: (keep: number, keepIds: string[]) => Promise<void>;
  /** flag pre-`auto` Wallhaven downloads ("wallhaven-*" images) as auto, except `keepIds` */
  adoptLegacyWallhaven: (keepIds: string[]) => Promise<void>;
}

function toMeta(row: WallpaperRow): WallpaperMeta {
  const { blob: _blob, original: _original, ...meta } = row;
  return meta;
}

/** Shrink to screen size first, THEN enforce the storage cap — a 15MB 4K PNG
 *  ends up as a ~1MB WebP and is perfectly fine to keep. */
async function imageRow(source: Blob, name: string, auto?: boolean): Promise<WallpaperRow> {
  if (source.size > MAX_SOURCE_IMAGE_BYTES) throw new Error("image-too-large");
  const processed = await processImage(source);
  if (processed.blob.size > MAX_IMAGE_BYTES) throw new Error("image-too-large");
  return {
    id: crypto.randomUUID(),
    type: "image",
    blob: processed.blob,
    name,
    size: processed.blob.size,
    width: processed.width,
    height: processed.height,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    ...(auto ? { auto: true } : {}),
    // processImage hands the source back untouched when no work was needed —
    // only a real re-encode is worth a second copy
    ...(processed.blob !== source ? { original: source } : {}),
  };
}

export const useWallpaperStore = create<WallpaperState>((set, get) => ({
  loaded: false,
  items: [],

  load: async () => {
    const rows = await db.wallpapers.orderBy("createdAt").reverse().toArray();
    set({ items: rows.map(toMeta), loaded: true });
  },

  addImageFile: async (file) => {
    const row = await imageRow(file, file.name);
    await db.wallpapers.add(row);
    set({ items: [toMeta(row), ...get().items] });
    return row.id;
  },

  addVideoFile: async (file) => {
    if (file.size > MAX_VIDEO_BYTES) throw new Error("video-too-large");
    // videos are stored as-is (docs/phase-1-mvp/01 §3 — no video processing)
    const row: WallpaperRow = {
      id: crypto.randomUUID(),
      type: "video",
      blob: file,
      name: file.name,
      size: file.size,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    await db.wallpapers.add(row);
    set({ items: [toMeta(row), ...get().items] });
    return row.id;
  },

  addFromUrl: async (url, opts) => {
    const blob = await fetchImageFromUrl(url);
    const row = await imageRow(blob, url.split("/").pop() ?? "url-image", opts?.auto);
    await db.wallpapers.add(row);
    set({ items: [toMeta(row), ...get().items] });
    return row.id;
  },

  remove: async (id) => {
    await db.wallpapers.delete(id);
    set({ items: get().items.filter((i) => i.id !== id) });
    emit("wallpaper:changed", { id: null });
  },

  touch: async (id) => {
    await db.wallpapers.update(id, { lastUsedAt: Date.now() });
  },

  cleanup: async (keepIds) => {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const stale = get().items.filter((i) => i.lastUsedAt < cutoff && !keepIds.includes(i.id));
    await db.wallpapers.bulkDelete(stale.map((i) => i.id));
    set({ items: get().items.filter((i) => !stale.some((s) => s.id === i.id)) });
    return stale.length;
  },

  pruneAuto: async (keep, keepIds) => {
    // query the DB, not `items` — the new-tab layer never loads the full library
    const autoIds = await db.wallpapers
      .orderBy("createdAt")
      .reverse()
      .filter((r) => r.auto === true)
      .primaryKeys();
    const doomed = autoIds.slice(keep).filter((id) => !keepIds.includes(id));
    if (doomed.length === 0) return;
    await db.wallpapers.bulkDelete(doomed);
    set({ items: get().items.filter((i) => !doomed.includes(i.id)) });
  },

  adoptLegacyWallhaven: async (keepIds) => {
    await db.wallpapers
      .filter(
        (r) =>
          r.type === "image" &&
          r.auto !== true &&
          /^wallhaven-/i.test(r.name) &&
          !keepIds.includes(r.id),
      )
      .modify({ auto: true });
  },
}));

/**
 * Load a wallpaper as an object URL (caller revokes). `original: true` serves
 * the uncompressed source when one was kept; otherwise the screen-fit copy.
 */
export async function getWallpaperUrl(
  id: string,
  opts: { original?: boolean } = {},
): Promise<{ url: string; type: "image" | "video" } | null> {
  const row = await db.wallpapers.get(id);
  if (!row) return null;
  const blob = opts.original && row.original ? row.original : row.blob;
  return { url: URL.createObjectURL(blob), type: row.type };
}

/** i18n key for an error thrown by this store */
export function wallpaperErrorKey(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (msg === "image-too-large") return "wallpaper.imageTooLarge";
  if (msg === "video-too-large") return "wallpaper.videoTooLarge";
  return "wallpaper.loadUrlError";
}

export async function wallpaperExists(id: string): Promise<boolean> {
  return (await db.wallpapers.where("id").equals(id).count()) > 0;
}
