import { browser } from "wxt/browser";
import { db } from "@/core/storage/db";
import { siteUrl, type RuntimeMessage } from "@/core/messaging";
import { fetchUnreadCount } from "@/features/newtab/panel-github/api";
import { githubConnection } from "@/features/newtab/panel-github/connection";
import { ALARM_NAME as POMODORO_ALARM, advanceOnFire } from "@/features/newtab/tool-pomodoro/state";
import {
  FLUSH_ALARM as TRACKER_FLUSH_ALARM,
  ROLLUP_ALARM as TRACKER_ROLLUP_ALARM,
  initActivityTracker,
  onAlarmFire as onTrackerAlarm,
  registerAlarms as registerTrackerAlarms,
  seedFromActiveTab,
  sweepOrphanSessions,
} from "@/features/site/web-time-tracker/background/activityTracker";
import {
  CLEAR_ALARM,
  onAlarmFire as onClearAlarm,
  onWindowRemoved as onClearWindowRemoved,
  syncAlarm as syncClearAlarm,
} from "@/features/site/auto-clear-cache/background/autoClear";
import {
  captureTab,
  initTabMixer,
  listTabGains,
  releaseTab,
  setTabGain,
  startTabCapture,
} from "@/features/popup/audio-mixer/background/tabMixer";

/**
 * Background service worker. MV3 workers can be killed at any time, so periodic
 * work uses chrome.alarms (never setTimeout) — docs/phase-3 §4. Phase 3 wires a
 * GitHub notification poll here so alerts fire even when no NewTab is open.
 * Pomodoro alarms (Phase 4) hang off the same alarm handler.
 *
 * It is also the message router for every surface — docs/architecture.md §7.
 */

const GITHUB_ALARM = "github-poll";
const ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
    // Messages the worker itself sends ON to the offscreen document come back
    // here too (runtime.sendMessage broadcasts to every extension context),
    // and several share a `type` with the cases below — without this guard the
    // worker would answer its own forwarded message and loop forever.
    if ((msg as { target?: string }).target === "offscreen") return undefined;

    // Always answer, success or failure: a handler that rejects without calling
    // sendResponse leaves the caller with "message port closed" instead of a
    // reason. A task resolving to undefined answers { ok: true }.
    const reply = (task: Promise<unknown>): true => {
      task
        .then((value) => sendResponse(value === undefined ? { ok: true } : value))
        .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;
    };

    switch (msg.type) {
      // Provide redirect URI to pages that can't access browser.identity directly
      // (e.g. newtab in wxt dev mode served from localhost)
      case "getRedirectUri": {
        const base = browser.identity.getRedirectURL();
        sendResponse(msg.path ? `${base}${msg.path}` : base);
        return true; // Keep the message channel open for async response
      }
      case "site:open":
        return reply(openSite(msg.route ?? "/").then(() => true));
      case "tabMixer:capture":
        return reply(captureTab(msg.tabId, msg.streamId, msg.gain));
      case "tabMixer:start":
        return reply(startTabCapture(msg.tabId, msg.gain));
      case "tabMixer:setGain":
        return reply(setTabGain(msg.tabId, msg.gain));
      case "tabMixer:stop":
        return reply(releaseTab(msg.tabId));
      case "tabMixer:list":
        return reply(listTabGains().then((gains) => ({ ok: true, value: gains })));
      case "timeTracker:seed":
        // Granting the optional "tabs" permission fires no tab event of its
        // own — without this, tracking would silently wait for the next
        // manual tab switch before the first session ever started.
        return reply(seedFromActiveTab().then(() => true));
      default:
        return undefined; // not ours — let other listeners (content scripts) answer
    }
  });

  initActivityTracker();
  initTabMixer();
  browser.windows.onRemoved.addListener(() => void onClearWindowRemoved());

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      browser.storage.local.set({ installedAt: Date.now() });
    }
    // poll GitHub every 15 minutes (cheap; no-ops when no token/permission)
    browser.alarms.create(GITHUB_ALARM, { periodInMinutes: 15 });
    registerTrackerAlarms();
    void sweepOrphanSessions();
    void syncClearAlarm();
  });

  browser.runtime.onStartup?.addListener(() => {
    browser.alarms.create(GITHUB_ALARM, { periodInMinutes: 15 });
    registerTrackerAlarms();
    void sweepOrphanSessions();
    void syncClearAlarm();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === GITHUB_ALARM) void pollGitHub();
    else if (alarm.name === POMODORO_ALARM) void firePomodoro();
    else if (alarm.name === TRACKER_ROLLUP_ALARM || alarm.name === TRACKER_FLUSH_ALARM) {
      void onTrackerAlarm(alarm.name);
    } else if (alarm.name === CLEAR_ALARM) {
      void onClearAlarm(alarm.name);
    }
  });
});

const SITE_TAB_KEY = "site.tabId";

/**
 * Focus an already-open site tab instead of piling up duplicates.
 *
 * Deliberately NOT `tabs.query({ url })`: that filter needs the "tabs"
 * permission, which Chrome surfaces to the user as "read your browsing
 * history" — far too much to pay for tab reuse. Remembering the id we opened
 * costs nothing and `tabs.get` works without any extra permission.
 */
async function openSite(route: string): Promise<void> {
  const url = siteUrl(route);
  const remembered = await browser.storage.local.get(SITE_TAB_KEY);
  const tabId = remembered[SITE_TAB_KEY] as number | undefined;

  if (tabId !== undefined) {
    try {
      const tab = await browser.tabs.get(tabId);
      await browser.tabs.update(tabId, { active: true, url });
      if (tab.windowId !== undefined) {
        await browser.windows.update(tab.windowId, { focused: true });
      }
      return;
    } catch {
      /* that tab is gone — fall through and open a fresh one */
    }
  }

  const created = await browser.tabs.create({ url });
  if (created.id !== undefined) {
    await browser.storage.local.set({ [SITE_TAB_KEY]: created.id });
  }
}

async function firePomodoro(): Promise<void> {
  try {
    const { title, body } = await advanceOnFire();
    const notif = await db.settings.get("notifications");
    const prefs = notif?.values ?? {};
    if (prefs.master === false || prefs["src:tool-pomodoro"] === false) return;

    const row = {
      id: crypto.randomUUID(),
      source: "tool-pomodoro",
      type: "alarm" as const,
      title,
      body,
      createdAt: Date.now(),
      readAt: null,
    };
    await db.notificationsLog.add(row);
    if (await browser.permissions.contains({ permissions: ["notifications"] })) {
      await browser.notifications.create(row.id, {
        type: "basic",
        iconUrl: ICON,
        title,
        message: body,
      });
    }
  } catch {
    /* ignore */
  }
}

async function pollGitHub(): Promise<void> {
  try {
    const [ghSettings, notifSettings, hasPerm] = await Promise.all([
      db.settings.get("panel-github"),
      db.settings.get("notifications"),
      browser.permissions.contains({ permissions: ["notifications"] }),
    ]);

    // notifications need a token — and only count in token mode (username mode
    // may still hold an old token the user switched away from)
    const conn = githubConnection(ghSettings?.values ?? {});
    const token = conn.mode === "token" ? conn.token : "";
    if (!token || !ghSettings?.enabled) return;

    // respect per-source + master notification toggles
    const notif = notifSettings?.values ?? {};
    if (notif.master === false || notif["src:panel-github"] === false) return;

    const count = await fetchUnreadCount(token);
    const prevRes = await browser.storage.local.get("github.lastUnread");
    const prev = Number(prevRes["github.lastUnread"] ?? 0);
    await browser.storage.local.set({ "github.lastUnread": count });

    if (count > prev && hasPerm) {
      const row = {
        id: crypto.randomUUID(),
        source: "panel-github",
        type: "info" as const,
        title: "GitHub",
        body: `${count} new notifications`,
        createdAt: Date.now(),
        readAt: null,
      };
      // log so the in-app center shows it next time a NewTab opens
      await db.notificationsLog.add(row);
      await browser.notifications.create(row.id, {
        type: "basic",
        iconUrl: ICON,
        title: row.title,
        message: row.body,
      });
    }
  } catch {
    /* worker may be torn down / offline — next alarm retries */
  }
}
