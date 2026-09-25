import { db } from "./db";
import { NETWORK_CACHE_PREFIX } from "./scopes";

/**
 * "Free up space" actions for the site Settings page. Each returns how many
 * items it removed. They work on tables/keys directly (core may not import
 * features), and never touch what is on screen right now.
 */

/** Wipe every row of the given tables (an app's "clear data"). */
export async function clearTables(tables: readonly string[]): Promise<number> {
  const present = tables.filter((n) => db.tables.some((t) => t.name === n));
  let removed = 0;
  await db.transaction("rw", present.map((n) => db.table(n)), async () => {
    for (const n of present) {
      removed += await db.table(n).count();
      await db.table(n).clear();
    }
  });
  return removed;
}

/** Wallpapers keep the screen-fit copy; the full-size originals go. */
export async function dropWallpaperOriginals(): Promise<number> {
  return db.wallpapers
    .filter((r) => r.original !== undefined)
    .modify((r) => {
      delete r.original;
    });
}

/** Auto-downloaded Wallhaven images, except the chosen one and the one on screen. */
export async function clearAutoWallpapers(): Promise<number> {
  const row = await db.settings.get("wallpaper");
  const keep = new Set(
    [row?.values.activeId, row?.values.wallhavenLastId].filter((v): v is string => typeof v === "string"),
  );
  const ids = await db.wallpapers.filter((r) => r.auto === true && !keep.has(r.id)).primaryKeys();
  await db.wallpapers.bulkDelete(ids);
  return ids.length;
}

export async function clearNotificationLog(): Promise<number> {
  const n = await db.notificationsLog.count();
  await db.notificationsLog.clear();
  return n;
}

/** Cached news/weather/etc. responses — refetched on next use. */
export function clearNetworkCache(): number {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(NETWORK_CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* blocked */
  }
  return keys.length;
}
