export interface Wallpaper {
  id: string;
  url: string;
  short_url: string;
  path: string;
  resolution: string;
  category: string;
  favorites: number;
  views: number;
  dimension_x: number;
  dimension_y: number;
  file_size: number;
  created_at: string;
  colors: string[];
  thumbs: {
    large: string;
    original?: string;
  };
}

export interface WallhavenMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  query?: string | null;
  seed?: string | null;
}

/**
 * One list for both "what" (keyword) and "kind" (Wallhaven category) — users
 * think in themes like "anime" or "chill", not in category bit-masks.
 * `categories` is Wallhaven's General/Anime/People mask.
 */
export interface WallhavenTopic {
  id: string;
  q: string;
  categories: string;
  icon: string;
}

export const WALLHAVEN_TOPICS: WallhavenTopic[] = [
  { id: "space", q: "space", categories: "100", icon: "🌌" },
  { id: "forest", q: "forest", categories: "100", icon: "🌲" },
  { id: "landscape", q: "landscape", categories: "100", icon: "🏞️" },
  { id: "mountains", q: "mountains", categories: "100", icon: "🏔️" },
  { id: "ocean", q: "sea", categories: "100", icon: "🌊" },
  { id: "city", q: "city", categories: "100", icon: "🏙️" },
  { id: "cyberpunk", q: "cyberpunk", categories: "110", icon: "🌃" },
  { id: "cinematic", q: "cinematic", categories: "100", icon: "🎬" },
  { id: "chill", q: "lofi", categories: "110", icon: "☕" },
  { id: "anime", q: "", categories: "010", icon: "🌸" },
  { id: "cartoon", q: "cartoon", categories: "110", icon: "🎨" },
  { id: "fantasy", q: "fantasy art", categories: "110", icon: "🐉" },
  { id: "minimal", q: "minimalism", categories: "100", icon: "◻️" },
  { id: "abstract", q: "abstract", categories: "100", icon: "🌀" },
];

export const DEFAULT_TOPIC_IDS = ["space", "forest", "city", "landscape"];

export function getTopic(id: string): WallhavenTopic | undefined {
  return WALLHAVEN_TOPICS.find((t) => t.id === id);
}

export type WallhavenResolution = "2560x1440" | "3840x2160";
export type WallhavenSorting =
  | "random"
  | "toplist"
  | "favorites"
  | "views"
  | "date_added"
  | "relevance";

export interface WallhavenSearchParams {
  q?: string;
  categories?: string; // "100" (General), "010" (Anime), "001" (People), "111" (All)
  purity?: string; // "100" (SFW)
  sorting?: WallhavenSorting;
  atleast?: WallhavenResolution; // "2560x1440" (2K+), "3840x2160" (4K+)
  ratios?: string; // "landscape" (only horizontal landscape)
  page?: number;
  seed?: string;
}

const BASE_URL = "https://wallhaven.cc/api/v1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRawWallpaper(item: any): Wallpaper {
  return {
    id: String(item.id),
    url: String(item.url || `https://wallhaven.cc/w/${item.id}`),
    short_url: String(item.short_url || `https://whvn.cc/${item.id}`),
    path: String(item.path),
    resolution: String(item.resolution || `${item.dimension_x}x${item.dimension_y}`),
    category: String(item.category || "general"),
    favorites: Number(item.favorites || 0),
    views: Number(item.views || 0),
    dimension_x: Number(item.dimension_x || 0),
    dimension_y: Number(item.dimension_y || 0),
    file_size: Number(item.file_size || 0),
    created_at: String(item.created_at || ""),
    colors: Array.isArray(item.colors) ? item.colors : [],
    thumbs: {
      large: String(item.thumbs?.large || item.thumbs?.small || item.path),
      original: item.thumbs?.original ? String(item.thumbs.original) : undefined,
    },
  };
}

/**
 * Search wallpapers using the official Wallhaven API:
 * GET https://wallhaven.cc/api/v1/search
 */
export async function searchWallhaven(
  params: WallhavenSearchParams = {},
): Promise<{ data: Wallpaper[]; meta: WallhavenMeta }> {
  const url = new URL(`${BASE_URL}/search`);
  if (params.q?.trim()) {
    url.searchParams.set("q", params.q.trim());
  }
  url.searchParams.set("categories", params.categories || "111");
  url.searchParams.set("purity", params.purity || "100"); // Safe For Work by default
  // Only landscape widescreen wallpapers (user requirement)
  url.searchParams.set("ratios", params.ratios || "landscape");
  // Minimum 2K resolution (2560x1440+) (user requirement)
  url.searchParams.set("atleast", params.atleast || "2560x1440");
  if (params.sorting) {
    url.searchParams.set("sorting", params.sorting);
  }
  if (params.page && params.page > 1) {
    url.searchParams.set("page", String(params.page));
  }
  if (params.seed) {
    url.searchParams.set("seed", params.seed);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Wallhaven search error: HTTP ${res.status}`);
  }
  const json = await res.json();
  const rawList = Array.isArray(json.data) ? json.data : [];
  return {
    data: rawList.map(mapRawWallpaper),
    meta: json.meta || {
      current_page: 1,
      last_page: 1,
      per_page: 24,
      total: rawList.length,
    },
  };
}

/**
 * Get detailed wallpaper info:
 * GET https://wallhaven.cc/api/v1/w/{id}
 */
export async function getWallhavenDetail(id: string): Promise<Wallpaper> {
  const res = await fetch(`${BASE_URL}/w/${id}`);
  if (!res.ok) {
    throw new Error(`Wallhaven detail error: HTTP ${res.status}`);
  }
  const json = await res.json();
  if (!json.data) {
    throw new Error("Invalid Wallhaven detail response");
  }
  return mapRawWallpaper(json.data);
}

export interface WallhavenAutoOptions {
  topicIds: string[];
  query: string;
  atleast: WallhavenResolution;
  /** 0 = new image on every tab */
  refreshMs: number;
  /** changes whenever the user changes what should be fetched */
  signature: string;
  /** max auto-downloaded images kept in the library */
  keep: number;
}

export const DEFAULT_WALLHAVEN_KEEP = 5;

export function wallhavenOptionsFrom(values: Record<string, unknown>): WallhavenAutoOptions {
  const topicIds = Array.isArray(values.wallhavenTopics)
    ? (values.wallhavenTopics as string[]).filter((id) => getTopic(id))
    : DEFAULT_TOPIC_IDS;
  const query = typeof values.wallhavenCustomQuery === "string" ? values.wallhavenCustomQuery.trim() : "";
  const atleast: WallhavenResolution =
    values.wallhavenResolution === "3840x2160" ? "3840x2160" : "2560x1440";
  const minutes = Number(values.wallhavenRefresh ?? 60);
  const refreshMs = Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0;
  const signature = [[...topicIds].sort().join(","), query, atleast].join("|");
  const rawKeep = Number(values.wallhavenKeep ?? DEFAULT_WALLHAVEN_KEEP);
  const keep = Number.isFinite(rawKeep) ? Math.max(1, Math.round(rawKeep)) : DEFAULT_WALLHAVEN_KEEP;
  return { topicIds, query, atleast, refreshMs, signature, keep };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Fetch one random landscape wallpaper. A custom query wins; otherwise a topic
 * is drawn from `topicIds` (falling back to the next one if a topic comes back
 * empty). Returns null when nothing could be fetched.
 */
export async function fetchRandomWallhavenWallpaper({
  topicIds = DEFAULT_TOPIC_IDS,
  query = "",
  atleast = "2560x1440",
}: {
  topicIds?: string[];
  query?: string;
  atleast?: WallhavenResolution;
} = {}): Promise<Wallpaper | null> {
  const custom = query.trim();
  const topics = shuffle(
    topicIds.map(getTopic).filter((t): t is WallhavenTopic => !!t),
  );
  const attempts: Array<{ q: string; categories: string }> = custom
    ? [{ q: custom, categories: "110" }]
    : (topics.length > 0 ? topics : WALLHAVEN_TOPICS).slice(0, 3);

  for (const { q, categories } of attempts) {
    try {
      const res = await searchWallhaven({
        q,
        categories,
        sorting: "random",
        atleast,
        ratios: "landscape",
        purity: "100",
      });
      if (res.data.length > 0) return res.data[0];
    } catch (err) {
      console.warn("fetchRandomWallhavenWallpaper failed:", err);
      return null; // network/API down — no point hammering the other topics
    }
  }
  return null;
}
