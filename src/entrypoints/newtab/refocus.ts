import { FOCUS_PARAM, readFocusFlag } from "@/features/newtab/search-bar/focus";

/**
 * Imported FIRST by main.tsx so it runs before the app boots: reload once with
 * `?focus=1` so the search box — not the address bar — gets keyboard focus.
 * See features/newtab/search-bar/focus.ts for why.
 */
function needsRefocus(): boolean {
  if (!readFocusFlag()) return false;
  return !new URLSearchParams(location.search).has(FOCUS_PARAM);
}

export const refocusing = needsRefocus();

if (refocusing) {
  const url = new URL(location.href);
  url.searchParams.set(FOCUS_PARAM, "1");
  // replace: no extra Back-button entry
  location.replace(url.href);
}
