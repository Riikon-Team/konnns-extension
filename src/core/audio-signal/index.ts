import { BeatDetector, OnsetTracker, bandEnergy, logBands, smoothInto } from "./engine";

/**
 * Audio signal bus — where audio SOURCES (MusicBox today; captured tabs later)
 * meet audio-reactive EFFECTS (visualizer, wallpaper pulse). Neither side
 * knows the other: sources register an AnalyserNode, effects subscribe to
 * analysed frames. Keeps features from importing each other (AGENTS.md §3).
 *
 * One shared requestAnimationFrame loop runs only while someone subscribes,
 * and does no analysis while no source is playing.
 */

/** One frame of byte frequency data (AnalyserNode layout: 0..255 per bin). */
export interface FreqSample {
  data: Uint8Array;
  /** sampleRate / fftSize */
  binHz: number;
}

export interface AudioSignalSource {
  id: string;
  /**
   * The latest spectrum, or null while this source is silent / not wired up.
   * Local sources read an AnalyserNode; remote ones (a captured browser tab,
   * analysed in the offscreen document) hand over the last frame received.
   */
  sample: () => FreqSample | null;
}

/** Adapter for the common case: an AnalyserNode that is live while `active()`. */
export function analyserSource(
  id: string,
  analyser: () => AnalyserNode | null,
  active: () => boolean,
): AudioSignalSource {
  let buf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  return {
    id,
    sample: () => {
      const a = analyser();
      if (!a || !active()) return null;
      if (buf.length !== a.frequencyBinCount) buf = new Uint8Array(a.frequencyBinCount);
      a.getByteFrequencyData(buf);
      return { data: buf, binHz: a.context.sampleRate / a.fftSize };
    },
  };
}

export interface AudioFrame {
  /** BAND_COUNT log-spaced bands, 0..1, smoothed */
  bands: Float32Array;
  /** smoothed bass level 0..1 */
  bass: number;
  /** kick pulse 0..1 — jumps on a beat, decays between beats */
  beat: number;
  /**
   * Low-end onset strength of this frame (multi-bin spectral flux, 25–170Hz,
   * see OnsetTracker) — for consumers that run their own BeatDetector with
   * user-tuned thresholds via `updateOnset` (the wallpaper pulse).
   */
  onset: number;
  /** false when nothing plays (values are decaying to 0) */
  active: boolean;
}

export const BAND_COUNT = 64;

const sources = new Map<string, AudioSignalSource>();
const subscribers = new Set<(frame: AudioFrame) => void>();

export function registerAudioSource(source: AudioSignalSource): () => void {
  sources.set(source.id, source);
  return () => {
    if (sources.get(source.id) === source) sources.delete(source.id);
  };
}

const frame: AudioFrame = { bands: new Float32Array(BAND_COUNT), bass: 0, beat: 0, onset: 0, active: false };
const onsetTracker = new OnsetTracker();
const rawBands = new Float32Array(BAND_COUNT);
const beat = new BeatDetector();
let raf = 0;
let lastT = 0;
let settled = true; // everything decayed to ~0 → skip callbacks until audio resumes

function pickSample(): FreqSample | null {
  for (const s of sources.values()) {
    const sample = s.sample();
    if (sample) return sample;
  }
  return null;
}

function tick(t: number) {
  raf = requestAnimationFrame(tick);
  const dt = lastT ? Math.min(100, t - lastT) : 16;
  lastT = t;

  const sample = pickSample();
  if (sample) {
    const { data: freq, binHz } = sample;
    logBands(freq, binHz, BAND_COUNT, 40, 16000, rawBands);
    // Sources now use maxDecibels −10 (headroom for beat detection) instead of
    // −30: the same sound maps 70/90 as high on the byte scale. Scale the bars
    // back so the visualizer looks as tall as before.
    for (let i = 0; i < BAND_COUNT; i++) rawBands[i] = Math.min(1, rawBands[i] * (90 / 70));
    const bassNow = bandEnergy(freq, binHz, 30, 150);
    frame.onset = onsetTracker.update(freq, binHz, t);
    frame.beat = beat.updateOnset(frame.onset, t);
    frame.bass += (bassNow - frame.bass) * (1 - Math.exp(-dt / (bassNow > frame.bass ? 30 : 180)));
    frame.active = true;
    settled = false;
  } else {
    if (settled) return;
    rawBands.fill(0);
    frame.onset = 0;
    frame.beat *= Math.exp(-dt / 170);
    frame.bass *= Math.exp(-dt / 180);
    frame.active = false;
  }

  smoothInto(frame.bands, rawBands, dt);

  if (!frame.active) {
    let peak = frame.beat + frame.bass;
    for (let i = 0; i < BAND_COUNT; i++) peak = Math.max(peak, frame.bands[i]);
    if (peak < 0.002) {
      frame.bands.fill(0);
      frame.bass = 0;
      frame.beat = 0;
      beat.reset();
      onsetTracker.reset();
      settled = true; // one last all-zero frame goes out below, then quiet
    }
  }

  for (const cb of subscribers) cb(frame);
}

/**
 * Receive analysed frames (~60/s while audio plays). The frame object is
 * reused between calls — read it inside the callback, don't keep it.
 */
export function subscribeAudioFrames(cb: (frame: AudioFrame) => void): () => void {
  subscribers.add(cb);
  if (!raf) {
    lastT = 0;
    raf = requestAnimationFrame(tick);
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
