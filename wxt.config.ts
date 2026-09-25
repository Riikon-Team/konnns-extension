import { defineConfig } from "wxt";

export default defineConfig({
  // auto-icons: generates 16/32/48/128 from src/assets/icon.png (512×512 source)
  // and greys it out in dev so the dev build is easy to tell apart
  modules: ["@wxt-dev/module-react", "@wxt-dev/auto-icons"],
  srcDir: "src",
  manifest: {
    name: "My NewTab",
    description: "Personal NewTab — search, clock, weather, wallpaper, bookmarks",
    permissions: [
      "storage",
      "unlimitedStorage",
      "alarms",
      "geolocation",
      "identity",
      "scripting",
      "activeTab",
      // low-sensitivity: only reports active/idle/locked, no page content or
      // tab identity — needed unconditionally so idle-pause accounting in
      // the Web Time Tracker works even before "tabs" is granted
      "idle",
      // Auto Clear Cache is unusable without this — chrome.browsingData.remove()
      // is the only API that does the actual clearing (docs/roadmap/06 §2's
      // note on when a tool must ask for a permission up front rather than
      // on demand: this is that exception)
      "browsingData",
    ] as string[],
    // "tabs" is here, not above: it is what lets an extension see the
    // url/title of tabs the user isn't currently looking at, which Chrome
    // surfaces at install/grant time as a real "read your browsing history"
    // style warning (docs/roadmap/04-web-time-tracker.md §5) — requested at
    // runtime only when the user turns the Web Time Tracker on, never at
    // install.
    // "clipboardRead" is only for the Image Editor's click-to-paste button;
    // Ctrl+V there rides the browser's own `paste` event and needs nothing
    // (docs/roadmap/07-image-editor.md §5), so this is asked for at the
    // button, not at install.
    // "tabCapture"/"offscreen" are only for the Audio Mixer's per-tab volume:
    // capturing a tab takes over its audio, so it is asked for at the slider,
    // per tab, and never at install (docs/site/07-audio-mixer.md).
    optional_permissions: ["bookmarks", "notifications", "topSites", "tabs", "clipboardRead", "tabCapture", "offscreen"],
    host_permissions: ["https://wallhaven.cc/*", "https://*.wallhaven.cc/*"],
    commands: {
      "capture-tab-audio": {
        suggested_key: { default: "Alt+Shift+V" },
        description: "Show this tab's music on the New Tab (toggle)",
      },
    },
    optional_host_permissions: ["*://*/*"],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    browser_specific_settings: {
      gecko: {
        id: "my-newtab@example.com",
        strict_min_version: "112.0",
      },
    },
  },
  webExt: {
    chromiumArgs: ["--window-size=1600,1000", "--window-position=80,40"],
  },
  hooks: {
   
    "build:manifestGenerated": (wxt, manifest) => {
      if (wxt.config.command === "serve") return;
      if (!manifest.host_permissions) return;
      // match on intent, not one exact spelling, so re-wording the content
      // script's `matches` cannot silently reintroduce the install warning
      const ALL_SITES = ["*://*/*", "<all_urls>", "http://*/*", "https://*/*"];
      manifest.host_permissions = manifest.host_permissions.filter(
        (p: string) => !ALL_SITES.includes(p),
      );
      if (manifest.host_permissions.length === 0) delete manifest.host_permissions;
    },
  },
});
