/**
 * Who owns which IndexedDB table — the basis for per-scope backup, size
 * accounting and "free up space". Two kinds of owner:
 *
 *  - the New Tab (below): its settings, wallpapers, notes/tasks, MusicBox…
 *    `settings` also holds the shared theme/language, so it lives here.
 *  - each Apps & Tools app: declared by the app itself via `dataTables` in
 *    registerSiteApp (core/site-registry) — no central list to forget.
 */
export const NEWTAB_TABLES = [
  "settings",
  "wallpapers",
  "avatars",
  "customClocks",
  "windowStates",
  "notes",
  "tasks",
  "onboardingState",
  "notificationsLog",
  "audioAssets", // background music (core/sound)
  "mediaAssets", // Pomodoro phase media
  "musicTracks", // MusicBox library
] as const;

/** localStorage keys that are only a re-fetchable network cache (news, weather…) */
export const NETWORK_CACHE_PREFIX = "newtab.cache.";
