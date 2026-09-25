import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { IconButton } from "@/shared/ui";
import { hasPermissions, requestPermissions } from "@/core/permissions";
import { sendToBackground } from "@/core/messaging";

const DEFAULT_GAIN = 1;
const MAX_GAIN = 2;

/**
 * Per-tab volume — docs/roadmap/05-audio-mixer.md §2 step 4, with the scope
 * correction documented in docs/site/07-audio-mixer.md: Chrome only lets an
 * extension capture a tab it has activeTab for, which is the tab the popup
 * was just opened on. So this control appears on that row alone; every other
 * audible tab keeps plain mute/unmute.
 *
 * The capture SURVIVES switching away — so the workflow is "go to the loud
 * tab, set it to 40%, carry on", not "mix every tab from one list".
 *
 * Starting a capture has to happen inside this click handler: both the
 * permission request (gesture-safe, see core/permissions.ts) and
 * `getMediaStreamId` are rejected when they drift away from the user's
 * actual click.
 */
export function TabVolumeControl({
  tabId,
  gain,
  onGainChange,
}: {
  tabId: number;
  /** undefined = this tab is not captured yet, so it is playing at its own natural volume */
  gain: number | undefined;
  onGainChange: (gain: number | undefined) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (key: string, raw?: string) => {
    // the browser's raw reason goes to the console (the friendly key to the UI)
    if (raw) console.warn("[audio-mixer] capture failed:", raw);
    setError(key);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const granted =
        (await hasPermissions({ permissions: ["tabCapture", "offscreen"] })) ||
        (await requestPermissions({ permissions: ["tabCapture", "offscreen"] }));
      if (!granted) {
        fail("audioMixer.permissionDenied");
        return;
      }

      // the worker mints the stream id (Chrome's documented offscreen pattern)
      // using the activeTab grant this popup's opening gave the tab
      const reply = (await sendToBackground({ type: "tabMixer:start", tabId, gain: DEFAULT_GAIN })) as
        | { ok?: boolean; error?: string }
        | undefined;
      if (reply === undefined) {
        // Unpacked extensions serve pages fresh from disk, but the service
        // worker keeps running the code it started with until the extension is
        // reloaded — a new popup talking to an old worker gets no answer.
        fail("audioMixer.errStaleWorker", "no reply from background (worker older than this popup?)");
        return;
      }
      if (!reply.ok) {
        fail(explainCaptureError(reply.error), reply.error);
        return;
      }
      onGainChange(DEFAULT_GAIN);
    } catch (err) {
      fail("audioMixer.errCaptureFailed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const change = (next: number) => {
    onGainChange(next);
    void sendToBackground({ type: "tabMixer:setGain", tabId, gain: next });
  };

  const release = () => {
    onGainChange(undefined);
    void sendToBackground({ type: "tabMixer:stop", tabId });
  };

  if (gain === undefined) {
    // not captured: rendered INSIDE the row's title line (MixerTabRow); the
    // error wraps onto its own line below (flex-basis 100%)
    return (
      <>
        <IconButton label={t("audioMixer.enableVolume")} disabled={busy} onClick={() => void start()}>
          <SlidersHorizontal size={14} />
        </IconButton>
        {error && <span className="amx__start-error">{t(error)}</span>}
      </>
    );
  }

  return (
    <div className="amx__volume">
      <input
        className="amx__volume-slider"
        type="range"
        min={0}
        max={MAX_GAIN * 100}
        step={5}
        value={Math.round(gain * 100)}
        aria-label={t("audioMixer.volumeLabel")}
        onChange={(e) => change(Number(e.target.value) / 100)}
      />
      <span className="amx__volume-value">{Math.round(gain * 100)}%</span>
      <IconButton label={t("audioMixer.releaseTab")} onClick={release}>
        <RotateCcw size={13} />
      </IconButton>
    </div>
  );
}

/**
 * Browser reason → an i18n key. The one that matters: "has not been invoked"
 * = no activeTab for this tab. A popup opened BY CODE (the shortcut does that
 * when permission is still missing) doesn't count as invoking the extension —
 * only the user's own icon click or keyboard shortcut does.
 */
function explainCaptureError(reason: string | undefined): string {
  if (!reason) return "audioMixer.errCaptureFailed";
  if (/not been invoked|activeTab/i.test(reason)) return "audioMixer.errNotInvoked";
  if (/chrome pages|cannot be captured/i.test(reason)) return "audioMixer.errCannotCapture";
  return reason.startsWith("audioMixer.") ? reason : "audioMixer.errCaptureFailed";
}
