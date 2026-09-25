export interface SearchEngine {
  id: string;
  label: string;
  url: string; // %s = query placeholder
  bang: string;
  /** autocomplete provider used while typing for this engine */
  suggest: SuggestProviderId;
}

export type SuggestProviderId = "google" | "youtube" | "bing" | "duckduckgo";

export const engines: SearchEngine[] = [
  { id: "google", label: "Google", url: "https://www.google.com/search?q=%s", bang: "g", suggest: "google" },
  { id: "bing", label: "Bing", url: "https://www.bing.com/search?q=%s", bang: "b", suggest: "bing" },
  { id: "duckduckgo", label: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s", bang: "d", suggest: "duckduckgo" },
  {
    id: "youtube",
    label: "YouTube",
    url: "https://www.youtube.com/results?search_query=%s",
    bang: "yt",
    suggest: "youtube",
  },
];

export function getEngine(id: string): SearchEngine | undefined {
  return engines.find((e) => e.id === id);
}

/**
 * "!yt lofi" → YouTube + "lofi". Also matches a bare "!yt" / "!yt " so the UI
 * can show the target engine the moment the shortcut is complete, before any
 * query is typed. Unknown bangs return null (the text is searched as-is).
 */
export function parseBang(raw: string): { engine: SearchEngine; query: string } | null {
  const m = raw.trimStart().match(/^!(\w+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const engine = engines.find((e) => e.bang === m[1].toLowerCase());
  return engine ? { engine, query: (m[2] ?? "").trim() } : null;
}

/** Resolve the final URL; a bang shortcut overrides the default engine. */
export function buildSearchUrl(defaultEngineId: string, customUrl: string, rawQuery: string): string | null {
  let query = rawQuery.trim();
  let engineId = defaultEngineId;

  const bang = parseBang(query);
  if (bang) {
    engineId = bang.engine.id;
    query = bang.query;
  }
  if (!query) return null;

  const pattern =
    engineId === "custom" && customUrl.includes("%s")
      ? customUrl
      : (getEngine(engineId) ?? engines[0]).url;

  return pattern.replace("%s", encodeURIComponent(query));
}
