import { browser } from "wxt/browser";

/**
 * Background half of per-tab volume — docs/roadmap/05-audio-mixer.md §5.
 *
 * Three contexts have to cooperate, because no single one can do the whole
 * job: the POPUP mints the capture stream id (only a tab the extension was
 * just invoked on may be captured), this SERVICE WORKER owns the lifecycle
 * and the cleanup listeners (it outlives the popup, which is destroyed the
 * moment it closes), and the OFFSCREEN document owns the AudioContext (a
 * service worker has no DOM and so cannot make sound).
 *
 * Which gains are currently applied lives in `storage.session` rather than a
 * module variable: the worker is killed after ~30s idle, and a popup opened
 * afterwards still has to be able to show the right slider positions.
 */

const OFFSCREEN_PATH = "offscreen.html";
const GAINS_KEY = "audioMixer:gains";

type GainMap = Record<number, number>;

function sessionArea() {
  return (browser.storage as { session?: typeof browser.storage.local }).session ?? browser.storage.local;
}

async function readGains(): Promise<GainMap> {
  const res = await sessionArea().get(GAINS_KEY);
  return (res[GAINS_KEY] as GainMap | undefined) ?? {};
}

async function writeGains(gains: GainMap): Promise<void> {
  await sessionArea().set({ [GAINS_KEY]: gains });
}

/* ------------------------------------------------------ offscreen document */

interface OffscreenApi {
  hasDocument?: () => Promise<boolean>;
  createDocument: (opts: { url: string; reasons: string[]; justification: string }) => Promise<void>;
  closeDocument?: () => Promise<void>;
}

function offscreenApi(): OffscreenApi | undefined {
  return (globalThis as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen;
}

/**
 * Firefox has no offscreen documents / tabCapture, so the advanced tier is
 * Chromium-only and the UI has to be able to ask.
 *
 * Must NOT test `chrome.offscreen` / `chrome.tabCapture` themselves: both are
 * OPTIONAL permissions, and Chrome only creates those namespaces once they are
 * granted. Testing them hid the very button that requests the grant — and made
 * the Alt+Shift+V shortcut bail out silently — so nothing could ever start.
 * The Chromium build is MV3 and the Firefox build MV2, which is the real split.
 */
export function supportsTabVolume(): boolean {
  try {
    return browser.runtime.getManifest().manifest_version === 3;
  } catch {
    return false;
  }
}

let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const api = offscreenApi();
  if (!api) throw new Error("audioMixer.errNoOffscreen");

  if (await hasOffscreen()) return;
  // two captures started back to back would otherwise both try to create it
  if (creating) {
    await creating;
    return;
  }
  creating = api.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Apply per-tab volume to captured tab audio.",
  });
  try {
    await creating;
  } finally {
    creating = null;
  }
}

async function hasOffscreen(): Promise<boolean> {
  const api = offscreenApi();
  if (api?.hasDocument) return api.hasDocument();
  try {
    const contexts = await (
      browser.runtime as unknown as { getContexts?: (f: { contextTypes: string[] }) => Promise<unknown[]> }
    ).getContexts?.({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    return Array.isArray(contexts) && contexts.length > 0;
  } catch {
    return false;
  }
}

async function sendToOffscreen(message: Record<string, unknown>): Promise<{ ok: boolean; error?: string; value?: unknown }> {
  return (await browser.runtime.sendMessage({ ...message, target: "offscreen" })) as {
    ok: boolean;
    error?: string;
    value?: unknown;
  };
}

/* ----------------------------------------------------------------- actions */

export async function captureTab(tabId: number, streamId: string, gain: number): Promise<void> {
  await ensureOffscreen();
  const reply = await sendToOffscreen({ type: "tabMixer:capture", tabId, streamId, gain });
  if (!reply?.ok) throw new Error(reply?.error ?? "audioMixer.errCaptureFailed");
  await writeGains({ ...(await readGains()), [tabId]: gain });
  setCaptureBadge(tabId, true);
}

/**
 * "♪" on the toolbar icon for a captured tab — the one visible hint (next to
 * Chrome's own "sharing" dot) that this tab now feeds volume + music effects.
 */
function setCaptureBadge(tabId: number, on: boolean): void {
  const action = (browser as unknown as {
    action?: {
      setBadgeText: (d: { tabId: number; text: string }) => Promise<void>;
      setBadgeBackgroundColor?: (d: { tabId: number; color: string }) => Promise<void>;
    };
  }).action;
  if (!action) return;
  void action.setBadgeText({ tabId, text: on ? "♪" : "" }).catch(() => {});
  if (on) void action.setBadgeBackgroundColor?.({ tabId, color: "#0ea5e9" }).catch(() => {});
}

export async function setTabGain(tabId: number, gain: number): Promise<void> {
  const gains = await readGains();
  if (gains[tabId] === undefined) return; // not captured — nothing to adjust
  await sendToOffscreen({ type: "tabMixer:setGain", tabId, gain });
  await writeGains({ ...gains, [tabId]: gain });
}

/** Hands the tab back to the browser: its own audio output resumes. */
export async function releaseTab(tabId: number): Promise<void> {
  const gains = await readGains();
  if (gains[tabId] === undefined) return;
  if (await hasOffscreen()) await sendToOffscreen({ type: "tabMixer:stop", tabId });
  delete gains[tabId];
  await writeGains(gains);
  setCaptureBadge(tabId, false);
  await closeOffscreenIfIdle(gains);
}

/* ------------------------------------------------- keyboard shortcut toggle */

export const CAPTURE_COMMAND = "capture-tab-audio";

type ChromeCapture = {
  runtime?: { lastError?: { message?: string } };
  tabCapture?: { getMediaStreamId?: (o: { targetTabId: number }, cb: (id?: string) => void) => void };
};

/**
 * `chrome.tabCapture.getMediaStreamId` — callback-only, callable from the
 * worker since Chrome 116 (the pattern Chrome documents for offscreen
 * consumers). Rejects with the browser's own reason, never a bare null.
 */
function mintStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chromeApi = (globalThis as { chrome?: ChromeCapture }).chrome;
    const api = chromeApi?.tabCapture;
    if (!api?.getMediaStreamId) return reject(new Error("tabCapture API unavailable (permission not active yet?)"));
    try {
      api.getMediaStreamId({ targetTabId }, (id) => {
        const err = chromeApi?.runtime?.lastError?.message;
        if (err || !id) reject(new Error(err ?? "getMediaStreamId returned no id"));
        else resolve(id);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Popup "volume" button → capture the tab it was opened on. The popup opening
 * granted activeTab for that tab, which the worker can use to mint the id.
 */
export async function startTabCapture(tabId: number, gain: number): Promise<void> {
  try {
    const streamId = await mintStreamId(tabId);
    await captureTab(tabId, streamId, gain);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await recordCaptureError(tabId, reason);
    throw new Error(reason);
  }
}

/**
 * Alt+Shift+V on a playing tab: capture it (music effects on the New Tab +
 * volume control), or release it if already captured. A keyboard command
 * grants activeTab for the current tab — exactly what getMediaStreamId needs,
 * so no popup is required. Without the (optional) permissions yet, open the
 * popup instead: permissions can only be granted from a page click.
 */
async function toggleCaptureFromCommand(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  if (!supportsTabVolume()) return recordCaptureError(tabId, "unsupported");
  if ((await readGains())[tabId] !== undefined) {
    await releaseTab(tabId);
    return;
  }
  const granted = await browser.permissions
    .contains({ permissions: ["tabCapture", "offscreen"] } as Parameters<typeof browser.permissions.contains>[0])
    .catch(() => false);
  if (!granted) {
    await recordCaptureError(tabId, "no-permission");
    const action = (browser as unknown as { action?: { openPopup?: () => Promise<void> } }).action;
    await action?.openPopup?.().catch(() => {});
    return;
  }
  await startTabCapture(tabId, 1).catch(() => {}); // reason already recorded
}

/* ---------------------------------------------------- failure breadcrumbs */

/**
 * A capture that fails from the keyboard shortcut has no UI to report to, so
 * leave a trace: a red "!" on the icon for that tab (replaced by "♪" on the
 * next successful capture) and the reason in the worker console.
 */
async function recordCaptureError(tabId: number, reason: string): Promise<void> {
  console.warn("[tabMixer] capture failed:", reason);
  const action = (browser as unknown as {
    action?: {
      setBadgeText: (d: { tabId: number; text: string }) => Promise<void>;
      setBadgeBackgroundColor?: (d: { tabId: number; color: string }) => Promise<void>;
    };
  }).action;
  void action?.setBadgeText({ tabId, text: "!" }).catch(() => {});
  void action?.setBadgeBackgroundColor?.({ tabId, color: "#ef4444" }).catch(() => {});
}

export async function listTabGains(): Promise<GainMap> {
  return readGains();
}

/** An offscreen document with nothing left to do still counts against the one-document limit and keeps an AudioContext alive. */
async function closeOffscreenIfIdle(gains: GainMap): Promise<void> {
  if (Object.keys(gains).length > 0) return;
  const api = offscreenApi();
  if (api?.closeDocument && (await hasOffscreen())) {
    try {
      await api.closeDocument();
    } catch {
      /* already gone */
    }
  }
}

/* ---------------------------------------------------------------- listeners */

/**
 * Registered unconditionally from background.ts, same as every other tool in
 * this project. Without the onRemoved cleanup, a closed captured tab leaves
 * its audio nodes alive and the offscreen document open (docs/roadmap/05 §5).
 *
 * Deliberately NOT released on URL change any more: Chrome keeps a tab
 * capture across navigations within the tab, and single-page players change
 * the URL on every track (YouTube autoplay → pushState) — releasing there cut
 * the music visualizer (and the volume setting) off after each song.
 */
export function initTabMixer(): void {
  browser.commands?.onCommand.addListener((command, tab) => {
    if (command !== CAPTURE_COMMAND) return;
    if (tab?.id !== undefined) return void toggleCaptureFromCommand(tab.id);
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([active]) => toggleCaptureFromCommand(active?.id));
  });
  browser.tabs.onRemoved.addListener((tabId) => void releaseTab(tabId));
}
