import { useEffect, useId, useRef, useState } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerFeature } from "@/core/feature-registry";
import { useFeatureValues, useSettingsStore } from "@/core/settings-engine/settingsStore";
import { brandIcons } from "@/shared/icons";
import { buildSearchUrl, engines, getEngine, parseBang } from "./engines";
import { searchSettingsSchema } from "./settings.schema";
import { fetchSuggestions, hasSuggestPermission, requestSuggestPermission } from "./suggest";
import { writeFocusFlag } from "./focus";
import "./search-bar.css";

export const SEARCH_FEATURE_ID = "search-bar";

const SUGGEST_DEBOUNCE_MS = 180;

interface SearchValues {
  [key: string]: unknown;
  engine?: string;
  customUrl?: string;
  position?: string;
  suggestions?: boolean;
  autofocus?: boolean;
}

function SearchBar() {
  const { t } = useTranslation();
  const values = useFeatureValues<SearchValues>(SEARCH_FEATURE_ID);
  const setValue = useSettingsStore((s) => s.setValue);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const engineId = values.engine ?? "google";
  const suggestOn = values.suggestions !== false;

  // "!yt …" etc. — show where Enter will actually go
  const bang = parseBang(query);
  const target = bang?.engine ?? getEngine(engineId);
  const searchText = bang ? bang.query : query.trim();

  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [permission, setPermission] = useState<"unknown" | "granted" | "missing">("unknown");

  const autofocus = values.autofocus === true;
  useEffect(() => {
    if (autofocus) inputRef.current?.focus();
  }, [autofocus]);

  useEffect(() => {
    if (!suggestOn) return;
    void hasSuggestPermission().then((ok) => setPermission(ok ? "granted" : "missing"));
  }, [suggestOn]);

  // debounced fetch; the previous request is aborted so late answers never
  // overwrite newer ones
  const provider = target?.suggest ?? "google";
  useEffect(() => {
    setHighlight(-1);
    if (!suggestOn || permission !== "granted" || !searchText) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetchSuggestions(provider, searchText, ctrl.signal)
        .then(setSuggestions)
        .catch(() => {
          /* aborted / offline — just no suggestions */
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [suggestOn, permission, provider, searchText]);

  const go = (text: string) => {
    const url = buildSearchUrl(engineId, values.customUrl ?? "", text);
    if (url) window.location.href = url;
  };

  // keep the bang when a suggestion is picked, so "!yt lo" → "!yt lofi" still goes to YouTube
  const withBang = (s: string) => (bang ? `!${bang.engine.bang} ${s}` : s);

  const cycleEngine = () => {
    const ids = engines.map((e) => e.id);
    const next = ids[(ids.indexOf(engineId) + 1) % ids.length];
    setValue(SEARCH_FEATURE_ID, "engine", next);
  };

  const engineLabel =
    engineId === "custom" ? "Custom" : (getEngine(engineId)?.label ?? "Google");
  const EngineIcon = brandIcons[engineId] ?? brandIcons.custom;
  const BangIcon = bang ? (brandIcons[bang.engine.id] ?? brandIcons.custom) : null;

  const showList = focused && suggestions.length > 0;
  const showAsk = focused && suggestOn && permission === "missing" && !!searchText;

  const maxWidth = typeof values.maxWidth === "number" ? values.maxWidth : 620;
  const opacity = typeof values.opacity === "number" ? values.opacity : 100;
  const blur = typeof values.blur === "number" ? values.blur : 16;

  return (
    <form
      className="search-bar"
      role="search"
      style={{
        width: `min(${maxWidth}px, 86vw)`,
        background: `color-mix(in srgb, var(--surface) ${opacity}%, transparent)`,
        backdropFilter: `blur(${blur}px)`,
      }}
      onSubmit={(e) => {
        e.preventDefault();
        go(highlight >= 0 && suggestions[highlight] ? withBang(suggestions[highlight]) : query);
      }}
    >
      {BangIcon && bang ? (
        <span
          key={bang.engine.id}
          className="search-bar__icon search-bar__icon--bang"
          title={t("search.bangTarget", { engine: bang.engine.label })}
        >
          <BangIcon size={20} />
        </span>
      ) : (
        <Search size={20} className="search-bar__icon" aria-hidden />
      )}
      {bang && <span className="search-bar__bang">{bang.engine.label}</span>}

      <input
        ref={inputRef}
        className="search-bar__input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = suggestions.length;
            setHighlight((h) => (e.key === "ArrowDown" ? (h + 1) % n : h <= 0 ? n - 1 : h - 1));
          } else if (e.key === "Escape") {
            setSuggestions([]);
          }
        }}
        placeholder={t("search.placeholder")}
        aria-label={t("search.placeholder")}
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
      />
      <button
        type="button"
        className="search-bar__engine"
        onClick={cycleEngine}
        title={`${t("search.engine")}: ${engineLabel}`}
        aria-label={`${t("search.engine")}: ${engineLabel}`}
      >
        <EngineIcon size={18} />
        <span className="search-bar__engine-label">{engineLabel}</span>
      </button>

      {showList && (
        <ul className="search-bar__suggest" id={listId} role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={`search-bar__suggest-item ${i === highlight ? "search-bar__suggest-item--active" : ""}`}
              // mousedown, not click: click fires after the input's blur has closed the list
              onMouseDown={(e) => {
                e.preventDefault();
                go(withBang(s));
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <Search size={14} aria-hidden />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}

      {showAsk && (
        <div className="search-bar__suggest search-bar__ask" onMouseDown={(e) => e.preventDefault()}>
          <Sparkles size={15} aria-hidden />
          <span className="search-bar__ask-text">{t("search.suggestAsk")}</span>
          <button
            type="button"
            className="search-bar__ask-btn"
            onClick={() => {
              void requestSuggestPermission().then((ok) => setPermission(ok ? "granted" : "missing"));
            }}
          >
            {t("search.suggestEnable")}
          </button>
          <button
            type="button"
            className="search-bar__ask-close"
            aria-label={t("search.suggestDismiss")}
            title={t("search.suggestDismiss")}
            onClick={() => setValue(SEARCH_FEATURE_ID, "suggestions", false)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </form>
  );
}

// Mirror "search bar on + its autofocus on" into the sync flag the entrypoint
// reads before boot. Runs on every settings change; writes only on change.
let lastFocusFlag: boolean | null = null;
useSettingsStore.subscribe((s) => {
  if (!s.hydrated) return;
  const on =
    (s.enabled[SEARCH_FEATURE_ID] ?? true) && s.values[SEARCH_FEATURE_ID]?.autofocus === true;
  if (on === lastFocusFlag) return;
  lastFocusFlag = on;
  writeFocusFlag(on);
});

registerFeature({
  id: SEARCH_FEATURE_ID,
  zone: "center",
  nameKey: "features.search-bar",
  icon: Search,
  defaultEnabled: true,
  settingsSchema: searchSettingsSchema,
  component: SearchBar,
  order: 2,
});

export default SearchBar;
