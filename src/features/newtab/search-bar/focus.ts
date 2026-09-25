/**
 * Chrome always gives keyboard focus to the address bar on an overridden New
 * Tab, so `input.focus()` alone does nothing. The only known way around it is
 * for the page to navigate itself once: a page-initiated navigation keeps focus
 * in the page. The entrypoint does that (entrypoints/newtab/refocus.ts); this
 * file owns the flag it reads, because the settings live in IndexedDB and are
 * not readable synchronously before the app boots.
 *
 * Trade-off: the address bar then shows the extension URL instead of staying
 * empty — which is why it is an opt-in flag (search bar › autofocus, off).
 */
export const FOCUS_FLAG_KEY = "newtab.focusSearch";
export const FOCUS_PARAM = "focus";

export function writeFocusFlag(on: boolean): void {
  try {
    localStorage.setItem(FOCUS_FLAG_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked — autofocus just falls back to plain focus() */
  }
}

/** Default (flag never written) = off, matching the setting's default. */
export function readFocusFlag(): boolean {
  try {
    return localStorage.getItem(FOCUS_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}
