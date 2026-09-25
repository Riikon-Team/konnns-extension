import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/core/settings-engine/settingsStore";
import { useTranslation } from "react-i18next";
import { browser } from "wxt/browser";
import { Volume2 } from "lucide-react";
import { Collapsible } from "@/shared/ui";
import { hasPermissions, requestPermissions } from "@/core/permissions";
import { getActiveTab, sendToBackground } from "@/core/messaging";
import { supportsTabVolume } from "./background/tabMixer";
import { MixerTabRow } from "./MixerTabRow";
import type { MixerTab } from "./engine/types";
import "./audio-mixer.css";

/**
 * Root widget — docs/roadmap/05-audio-mixer.md §2/§3. Registered into the
 * popup widget registry (see index.tsx); renders nothing at all when there
 * is nothing audible, so it never takes up space in a popup where it isn't
 * useful. `tabs.query({ audible: true })` itself needs no permission — only
 * `title`/`favIconUrl` and `tabs.update()` do, which is why the tab list can
 * be queried before the user has granted anything, purely to decide whether
 * the "enable" prompt is even worth showing.
 */
export function AudioMixerWidget() {
  const { t } = useTranslation();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [tabs, setTabs] = useState<MixerTab[]>([]);
  /** the one tab whose volume can be changed — see TabVolumeControl for why it is only ever one */
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [gains, setGains] = useState<Record<number, number> | null>(null);

  // Auto-capture: opening the popup IS the user action the browser requires
  // (activeTab), so a playing, not-yet-captured active tab is captured right
  // away — no button. Setting lives with Music effects ("music-fx"); read by
  // id since features don't import each other. Needs the permission already:
  // a permission prompt can't be raised without a click.
  const settingsReady = useSettingsStore((s) => s.hydrated);
  // `=== true`: music-fx is off by default and isn't registered in the popup,
  // so "no stored row" must read as OFF here (a fresh install never captures)
  const autoCapture = useSettingsStore(
    (s) => s.enabled["music-fx"] === true && s.values["music-fx"]?.autoCapture !== false,
  );
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || !settingsReady || !autoCapture || !supportsTabVolume()) return;
    if (activeTabId === null || gains === null) return; // still loading
    if (!tabs.some((t) => t.tabId === activeTabId) || gains[activeTabId] !== undefined) return;
    autoTried.current = true;
    void (async () => {
      if (!(await hasPermissions({ permissions: ["tabCapture", "offscreen"] }))) return;
      const reply = (await sendToBackground({ type: "tabMixer:start", tabId: activeTabId, gain: 1 })) as
        | { ok?: boolean }
        | undefined;
      if (reply?.ok) setGains((prev) => ({ ...(prev ?? {}), [activeTabId]: 1 }));
    })().catch(() => {
      /* best-effort: the manual "enable volume" button still reports errors */
    });
  }, [settingsReady, autoCapture, activeTabId, gains, tabs]);

  const refresh = useCallback(async () => {
    const all = await browser.tabs.query({ audible: true });
    setTabs(
      all
        .filter((t): t is typeof t & { id: number; windowId: number } => t.id !== undefined && t.windowId !== undefined)
        .map((t) => ({
          tabId: t.id,
          windowId: t.windowId,
          title: t.title ?? "",
          favIconUrl: t.favIconUrl,
          audible: t.audible ?? false,
          muted: t.mutedInfo?.muted ?? false,
        })),
    );
  }, []);

  useEffect(() => {
    void hasPermissions({ permissions: ["tabs"] }).then(setGranted);
    void refresh();
    void getActiveTab().then((tab) => setActiveTabId(tab?.id ?? null));
    // the popup is destroyed on close, so which tabs are already captured has
    // to be re-read from the worker every time it opens
    if (supportsTabVolume()) {
      void sendToBackground({ type: "tabMixer:list" })
        .then((reply) => setGains((reply as { value?: Record<number, number> })?.value ?? {}))
        .catch(() => setGains({}));
    } else {
      setGains({});
    }
    const onChange = () => void refresh();
    browser.tabs.onUpdated.addListener(onChange);
    browser.tabs.onRemoved.addListener(onChange);
    return () => {
      browser.tabs.onUpdated.removeListener(onChange);
      browser.tabs.onRemoved.removeListener(onChange);
    };
  }, [refresh]);

  const grant = async () => {
    // must stay in this same click handler, no intervening await before it —
    // gesture-safe request, see core/permissions.ts
    const ok = await requestPermissions({ permissions: ["tabs"] });
    setGranted(ok);
    if (ok) void refresh();
  };

  if (tabs.length === 0) return null; // nothing playing — take up no space

  if (!granted) {
    return (
      <Collapsible id="popup.audio" title={t("audioMixer.title")} icon={Volume2} count={tabs.length}>
        <button type="button" className="amx__grant" onClick={() => void grant()}>
          <Volume2 size={15} />
          {t("audioMixer.enable")}
        </button>
      </Collapsible>
    );
  }

  return (
    <Collapsible id="popup.audio" title={t("audioMixer.title")} icon={Volume2} count={tabs.length}>
      <ul className="amx__list">
        {tabs.map((tab) => (
          <MixerTabRow
            key={tab.tabId}
            tab={tab}
            onChanged={refresh}
            // only the tab the popup was opened on can be captured at all
            volumeGain={supportsTabVolume() && tab.tabId === activeTabId ? (gains?.[tab.tabId] ?? null) : undefined}
            onVolumeChange={(gain) =>
              setGains((prev) => {
                const next = { ...(prev ?? {}) };
                if (gain === undefined) delete next[tab.tabId];
                else next[tab.tabId] = gain;
                return next;
              })
            }
          />
        ))}
      </ul>
    </Collapsible>
  );
}
