import { registerAudioSource, type FreqSample } from "./index";

/**
 * Captured-tab audio → New Tab. A browser tab's sound can only be captured in
 * the offscreen document (see entrypoints/offscreen/main.ts), and it is
 * analysed there; the spectrum is streamed to any open New Tab over a
 * BroadcastChannel (same extension origin, no background round-trip, cheap
 * enough for ~30 small frames a second).
 *
 * Receivers announce themselves with a periodic "listen" heartbeat; the
 * sender only analyses while one was heard recently, so a captured tab costs
 * nothing extra when no New Tab is watching.
 */
export const AUDIO_CHANNEL = "konnn:audio-signal";
export const LISTEN_EVERY_MS = 2000;
/** sender stops streaming this long after the last heartbeat */
export const LISTEN_TTL_MS = 5000;
/** a frame older than this means the stream stopped (tab released / paused) */
const FRAME_TTL_MS = 300;

export type AudioChannelMessage =
  | { kind: "listen" }
  | { kind: "frame"; data: Uint8Array; binHz: number; tabId: number };

/**
 * New Tab side: register the captured tab as an audio source and keep the
 * heartbeat going. Returns a disconnect function.
 */
export function connectCapturedTabSource(): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(AUDIO_CHANNEL);
  let last: FreqSample | null = null;
  let lastAt = 0;

  channel.onmessage = (e: MessageEvent<AudioChannelMessage>) => {
    const msg = e.data;
    if (msg?.kind !== "frame") return;
    last = { data: msg.data, binHz: msg.binHz };
    lastAt = performance.now();
  };

  const listen = () => {
    // a hidden tab draws nothing — don't ask the offscreen doc to analyse for it
    if (!document.hidden) channel.postMessage({ kind: "listen" } satisfies AudioChannelMessage);
  };
  listen();
  const heartbeat = window.setInterval(listen, LISTEN_EVERY_MS);
  document.addEventListener("visibilitychange", listen);

  const unregister = registerAudioSource({
    id: "captured-tab",
    sample: () => (last && performance.now() - lastAt < FRAME_TTL_MS ? last : null),
  });

  return () => {
    unregister();
    window.clearInterval(heartbeat);
    document.removeEventListener("visibilitychange", listen);
    channel.close();
  };
}
