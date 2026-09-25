/**
 * Offscreen document — the only place in an MV3 extension that has both a
 * DOM and an `AudioContext`, which is exactly what per-tab volume needs
 * (docs/roadmap/05-audio-mixer.md §5). The service worker can mint a tab
 * capture stream id but cannot turn it into audible sound; this page can.
 *
 * The routing that matters, and the one thing that must never be got wrong:
 *
 *     captured tab  →  MediaStreamAudioSourceNode  →  GainNode  →  destination
 *
 * Capturing a tab TAKES OVER its audio output — the tab stops playing to the
 * speakers by itself and its sound now exists only inside this stream. If
 * the graph is not connected all the way through to `destination`, the tab
 * goes completely silent, which is the exact opposite of a volume control.
 * Every failure path below therefore tears the capture down rather than
 * leaving a half-built graph behind.
 */

import { browser } from "wxt/browser";
import {
  AUDIO_CHANNEL,
  LISTEN_TTL_MS,
  type AudioChannelMessage,
} from "@/core/audio-signal/channel";

interface Capture {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  /** music-effects tap, BEFORE the gain: turning a tab down doesn't flatten its visualizer */
  analyser: AnalyserNode;
  freq: Uint8Array<ArrayBuffer>;
  gain: GainNode;
}

interface MixerMessage {
  target?: string;
  type?: string;
  tabId?: number;
  streamId?: string;
  gain?: number;
}

const captures = new Map<number, Capture>();
let audioContext: AudioContext | null = null;

function context(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

async function startCapture(tabId: number, streamId: string, gain: number): Promise<void> {
  stopCapture(tabId); // re-capturing a tab replaces the old graph rather than stacking a second one

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // the non-standard constraint shape tab capture requires; the WebRTC
      // typings have no room for it, hence the cast
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    } as unknown as MediaTrackConstraints,
  });

  try {
    const ctx = context();
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    // low: analyser smoothing blunts a kick's onset (beat detection needs the
    // sharp rise); the visualizer smooths on its own side anyway
    analyser.smoothingTimeConstant = 0.15;
    // Default maxDecibels (−30) CLIPS bass-heavy music: on a real remix the
    // sub band sat at the 255 ceiling most of the time (median 0.99), so no
    // kick could rise above it. −10 leaves headroom (median ~0.80).
    analyser.maxDecibels = -10;
    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    // an analyser passes audio through untouched, so it sits in-line
    source.connect(analyser);
    analyser.connect(gainNode);
    gainNode.connect(ctx.destination); // ← without this the tab is silent
    captures.set(tabId, {
      stream,
      source,
      analyser,
      freq: new Uint8Array(analyser.frequencyBinCount),
      gain: gainNode,
    });
    ensureStreaming();
  } catch (err) {
    // never leave the tab captured-but-not-routed
    for (const track of stream.getTracks()) track.stop();
    throw err;
  }
}

function setGain(tabId: number, gain: number): void {
  const capture = captures.get(tabId);
  if (!capture) return;
  capture.gain.gain.value = gain;
}

/** Releases the tab: tracks stopped and nodes disconnected, so the tab goes back to playing through the browser itself. */
function stopCapture(tabId: number): void {
  const capture = captures.get(tabId);
  if (!capture) return;
  capture.source.disconnect();
  capture.analyser.disconnect();
  capture.gain.disconnect();
  for (const track of capture.stream.getTracks()) track.stop();
  captures.delete(tabId);
}

/* ----------------------------------------- music effects: stream the spectrum */

/**
 * ~60 frames/s to any New Tab listening on AUDIO_CHANNEL (see
 * core/audio-signal/channel.ts). setInterval, not rAF: this document is never
 * visible, so animation frames don't run here. Stops by itself when no tab is
 * captured or no New Tab has sent a heartbeat lately.
 */
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(AUDIO_CHANNEL) : null;
let lastListen = 0;
let streamTimer: ReturnType<typeof setInterval> | null = null;

channel?.addEventListener("message", (e: MessageEvent<AudioChannelMessage>) => {
  if (e.data?.kind !== "listen") return;
  lastListen = Date.now();
  ensureStreaming();
});

function ensureStreaming(): void {
  if (streamTimer || !channel) return;
  // ~60/s: at 30/s fast drum runs (16th notes ≈ 110ms apart) blurred together
  streamTimer = setInterval(streamFrame, 16);
}

function streamFrame(): void {
  if (captures.size === 0 || Date.now() - lastListen > LISTEN_TTL_MS) {
    clearInterval(streamTimer!);
    streamTimer = null;
    return;
  }
  // several captured tabs → show whichever is loudest right now
  let best: { tabId: number; capture: Capture; energy: number } | null = null;
  for (const [tabId, capture] of captures) {
    capture.analyser.getByteFrequencyData(capture.freq);
    let energy = 0;
    for (let i = 0; i < capture.freq.length; i += 4) energy += capture.freq[i];
    if (!best || energy > best.energy) best = { tabId, capture, energy };
  }
  if (!best || best.energy === 0) return; // silence: let receivers time out and fade
  const { analyser, freq } = best.capture;
  channel!.postMessage({
    kind: "frame",
    data: freq,
    binHz: analyser.context.sampleRate / analyser.fftSize,
    tabId: best.tabId,
  } satisfies AudioChannelMessage);
}

browser.runtime.onMessage.addListener((message: MixerMessage, _sender: unknown, sendResponse: (r: unknown) => void) => {
  if (message?.target !== "offscreen") return undefined;

  switch (message.type) {
    case "tabMixer:capture":
      void startCapture(message.tabId!, message.streamId!, message.gain ?? 1)
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      return true;

    case "tabMixer:setGain":
      setGain(message.tabId!, message.gain ?? 1);
      sendResponse({ ok: true });
      return true;

    case "tabMixer:stop":
      stopCapture(message.tabId!);
      sendResponse({ ok: true });
      return true;

    case "tabMixer:list":
      sendResponse({ ok: true, value: [...captures.keys()] });
      return true;

    default:
      return undefined;
  }
});
