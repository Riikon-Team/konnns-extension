import { db } from "./db";
import { NETWORK_CACHE_PREFIX } from "./scopes";

/**
 * Storage accounting for the site Settings page. IndexedDB has no per-table
 * size API, so sizes are MEASURED by walking the rows: Blob sizes are exact,
 * everything else is an estimate from its content. The browser's own total
 * (navigator.storage.estimate) also counts engine overhead, so the page shows
 * the difference as "other".
 */

/** Approximate stored size of a value, in bytes. Pure — no DB access. */
export function sizeOf(value: unknown): number {
  if (value == null) return 0;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  switch (typeof value) {
    case "string":
      return value.length;
    case "number":
      return 8;
    case "boolean":
      return 4;
    case "object": {
      let n = 0;
      if (Array.isArray(value)) for (const v of value) n += sizeOf(v);
      else for (const [k, v] of Object.entries(value)) n += k.length + sizeOf(v);
      return n;
    }
    default:
      return 0;
  }
}

/** Bytes per table (unknown tables are skipped). */
export async function measureTables(tables: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of tables) {
    if (!db.tables.some((t) => t.name === name)) continue;
    let bytes = 0;
    await db.table(name).each((row) => {
      bytes += sizeOf(row);
    });
    out[name] = bytes;
  }
  return out;
}

export function localStorageBytes(filter: (key: string) => boolean = () => true): number {
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !filter(key)) continue;
      n += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2; // UTF-16
    }
  } catch {
    /* blocked */
  }
  return n;
}

export const isNetworkCacheKey = (key: string) => key.startsWith(NETWORK_CACHE_PREFIX);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
