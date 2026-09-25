import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from "fflate";
import { db, DB_SCHEMA_VERSION, type AvatarRow, type WallpaperRow } from "./db";
import { NEWTAB_TABLES } from "./scopes";

/**
 * Backup / restore — docs/core-he-thong/03-storage-backup.md §2.
 *
 * Format v2 (this file): generic over tables, so ONE code path backs up the
 * New Tab, a single app, or everything:
 *
 *   manifest.json        { format, version: 2, schemaVersion, label, tables: {name: rowCount} }
 *   tables/<name>.json   the rows; every Blob — at any depth — replaced by {"__blob": path, "type"}
 *   blobs/<n>.<ext>      the Blob bytes, stored (not re-deflated: media is already compressed)
 *
 * Walking the rows for Blobs instead of naming fields keeps new Blob fields
 * (wallpaper `original`, image `thumbnail`…) from silently going missing —
 * v1 hand-listed fields and lost `original` exactly that way.
 *
 * v1 zips (manifest without `format`) are still importable, see importLegacy.
 */

const FORMAT = "konnn-backup";

interface ManifestV2 {
  format: typeof FORMAT;
  version: 2;
  schemaVersion: number;
  exportedAt: number;
  /** what was exported, for display: "newtab", "app:video-editor", "all" */
  label: string;
  tables: Record<string, number>;
}

interface BlobRef {
  __blob: string;
  type: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
  "application/pdf": "pdf",
};

const isBlobRef = (v: unknown): v is BlobRef =>
  !!v && typeof v === "object" && typeof (v as BlobRef).__blob === "string";

/** Replace every Blob in `value` with a BlobRef, collecting the bytes into `out`. */
export async function dehydrate(value: unknown, out: Map<string, Blob>): Promise<unknown> {
  if (value instanceof Blob) {
    const path = `blobs/${out.size}.${EXT_BY_MIME[value.type] ?? "bin"}`;
    out.set(path, value);
    return { __blob: path, type: value.type } satisfies BlobRef;
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => dehydrate(v, out)));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) res[k] = await dehydrate(v, out);
    return res;
  }
  return value;
}

/** Inverse of dehydrate: BlobRefs back into Blobs (a missing file becomes undefined). */
export function hydrate(value: unknown, files: Record<string, Uint8Array>): unknown {
  if (isBlobRef(value)) {
    const raw = files[value.__blob];
    return raw ? new Blob([raw as BlobPart], { type: value.type }) : undefined;
  }
  if (Array.isArray(value)) return value.map((v) => hydrate(v, files));
  if (value && typeof value === "object") {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) res[k] = hydrate(v, files);
    return res;
  }
  return value;
}

function download(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const knownTable = (name: string) => db.tables.some((t) => t.name === name);

/** Export the given tables as one v2 zip. */
export async function exportTables(tables: readonly string[], label: string, filename: string): Promise<void> {
  const blobs = new Map<string, Blob>();
  const files: Zippable = {};
  const manifest: ManifestV2 = {
    format: FORMAT,
    version: 2,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: Date.now(),
    label,
    tables: {},
  };

  for (const name of tables) {
    if (!knownTable(name)) continue;
    const rows = await db.table(name).toArray();
    manifest.tables[name] = rows.length;
    files[`tables/${name}.json`] = strToU8(JSON.stringify(await dehydrate(rows, blobs)));
  }
  for (const [path, blob] of blobs) {
    files[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

  download(zipSync(files, { level: 6 }), filename);
}

const today = () => new Date().toISOString().slice(0, 10);

/** New Tab only — apps & tools are backed up from the site Settings page. */
export function exportBackup(): Promise<void> {
  return exportTables(NEWTAB_TABLES, "newtab", `newtab-backup-${today()}.zip`);
}

export interface ImportResult {
  ok: boolean;
  error?: "invalid" | "newer-version";
  /** tables that were restored */
  tables?: string[];
  /** manifest label of a v2 file ("newtab", "app:…", "all") */
  label?: string;
}

/**
 * Restore a backup zip (v2, or legacy v1). Rows are MERGED: same id →
 * replaced, anything not in the file is kept. The caller should reload the
 * page afterwards — in-memory stores still hold the old data.
 */
export async function importBackup(file: File): Promise<ImportResult> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { ok: false, error: "invalid" };
  }
  const readJson = <T>(name: string): T | null => {
    const raw = entries[name];
    if (!raw) return null;
    try {
      return JSON.parse(strFromU8(raw)) as T;
    } catch {
      return null;
    }
  };

  const manifest = readJson<Partial<ManifestV2> & { schemaVersion?: number }>("manifest.json");
  if (!manifest || typeof manifest.schemaVersion !== "number") return { ok: false, error: "invalid" };
  if (manifest.schemaVersion > DB_SCHEMA_VERSION) return { ok: false, error: "newer-version" };
  if (manifest.format !== FORMAT) return importLegacy(entries, readJson);

  const restore: Array<{ name: string; rows: unknown[] }> = [];
  for (const name of Object.keys(manifest.tables ?? {})) {
    if (!knownTable(name)) continue; // table from a feature this build doesn't have
    const rows = readJson<unknown[]>(`tables/${name}.json`);
    if (!Array.isArray(rows)) return { ok: false, error: "invalid" };
    restore.push({ name, rows: hydrate(rows, entries) as unknown[] });
  }

  await db.transaction("rw", restore.map((r) => db.table(r.name)), async () => {
    for (const { name, rows } of restore) await db.table(name).bulkPut(rows);
  });
  return { ok: true, tables: restore.map((r) => r.name), label: manifest.label };
}

/* ------------------------------------------------------------ legacy (v1) */

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
);
const mimeOf = (path: string, fallback: string) => MIME_BY_EXT[path.split(".").pop() ?? ""] ?? fallback;

/** v1 layout: settings.json, data.json, wallpapers(.json|/), avatars(.json|/). */
async function importLegacy(
  entries: Record<string, Uint8Array>,
  readJson: <T>(name: string) => T | null,
): Promise<ImportResult> {
  const settings = readJson<import("./db").SettingsRow[]>("settings.json") ?? [];
  if (!Array.isArray(settings)) return { ok: false, error: "invalid" };
  const data =
    readJson<{
      customClocks?: import("./db").CustomClockRow[];
      windowStates?: import("./db").WindowStateRow[];
      notes?: import("./db").NoteRow[];
      tasks?: import("./db").TaskRow[];
    }>("data.json") ?? {};

  const withBlob = <R extends { blob: Blob }>(metas: Array<Omit<R, "blob"> & { file: string }>, fallback: string): R[] =>
    metas.flatMap((meta) => {
      const raw = entries[meta.file];
      if (!raw) return [];
      // v1 serialised extra Blob fields (e.g. wallpaper `original`) as {} — drop them
      const { file, original: _broken, ...rest } = meta as typeof meta & { original?: unknown };
      return [{ ...rest, blob: new Blob([raw as BlobPart], { type: mimeOf(file, fallback) }) } as unknown as R];
    });

  const wallpapers = withBlob<WallpaperRow>(
    readJson<Array<Omit<WallpaperRow, "blob"> & { file: string }>>("wallpapers.json") ?? [],
    "image/jpeg",
  );
  const avatars = withBlob<AvatarRow>(
    readJson<Array<Omit<AvatarRow, "blob"> & { file: string }>>("avatars.json") ?? [],
    "image/jpeg",
  );

  await db.transaction(
    "rw",
    [db.settings, db.wallpapers, db.avatars, db.customClocks, db.windowStates, db.notes, db.tasks],
    async () => {
      await Promise.all([
        db.settings.bulkPut(settings),
        db.wallpapers.bulkPut(wallpapers),
        db.avatars.bulkPut(avatars),
        db.customClocks.bulkPut(data.customClocks ?? []),
        db.windowStates.bulkPut(data.windowStates ?? []),
        db.notes.bulkPut(data.notes ?? []),
        db.tasks.bulkPut(data.tasks ?? []),
      ]);
    },
  );
  return {
    ok: true,
    label: "newtab",
    tables: ["settings", "wallpapers", "avatars", "customClocks", "windowStates", "notes", "tasks"],
  };
}
