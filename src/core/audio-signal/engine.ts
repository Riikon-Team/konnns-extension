/**
 * Pure analysis for audio-reactive effects — no DOM, no Web Audio, so it runs
 * under Node for testing (AGENTS.md §5). Input is an AnalyserNode's byte
 * frequency data (0..255 per bin); `binHz` = sampleRate / fftSize.
 */

/**
 * Collapse linear FFT bins into `count` log-spaced bands (0..1). Log spacing
 * matters: on a linear scale the bass — what people actually see move — would
 * squeeze into the first one or two bars. Each band takes its loudest bin,
 * which reads punchier than an average.
 */
export function logBands(
  freq: ArrayLike<number>,
  binHz: number,
  count: number,
  minHz = 40,
  maxHz = 16000,
  out: Float32Array = new Float32Array(count),
): Float32Array {
  const ratio = maxHz / minHz;
  const lastBin = freq.length - 1;
  for (let i = 0; i < count; i++) {
    const f0 = minHz * Math.pow(ratio, i / count);
    const f1 = minHz * Math.pow(ratio, (i + 1) / count);
    const b0 = Math.min(lastBin, Math.floor(f0 / binHz));
    const b1 = Math.min(lastBin, Math.max(b0, Math.ceil(f1 / binHz) - 1));
    let peak = 0;
    for (let b = b0; b <= b1; b++) if (freq[b] > peak) peak = freq[b];
    out[i] = peak / 255;
  }
  return out;
}

/** Mean level (0..1) of the bins between `loHz` and `hiHz`. */
export function bandEnergy(freq: ArrayLike<number>, binHz: number, loHz: number, hiHz: number): number {
  const b0 = Math.max(0, Math.floor(loHz / binHz));
  const b1 = Math.min(freq.length - 1, Math.max(b0, Math.ceil(hiHz / binHz)));
  let sum = 0;
  for (let b = b0; b <= b1; b++) sum += freq[b];
  return sum / ((b1 - b0 + 1) * 255);
}

/**
 * Fast-attack / slow-release smoothing, frame-rate independent. Visuals jump
 * up with the music but fall back gently instead of flickering.
 */
export function smoothInto(
  current: Float32Array,
  target: ArrayLike<number>,
  dtMs: number,
  attackMs = 35,
  releaseMs = 240,
): void {
  const up = 1 - Math.exp(-dtMs / attackMs);
  const down = 1 - Math.exp(-dtMs / releaseMs);
  for (let i = 0; i < current.length; i++) {
    const t = target[i] ?? 0;
    current[i] += (t - current[i]) * (t > current[i] ? up : down);
  }
}

/**
 * Multi-bin spectral flux of the low end: per-bin positive rise over the last
 * ~`windowMs`, averaged — the standard onset function. Measured on a dense,
 * bass-heavy remix (1076 reference kicks, browser analyser emulated offline):
 * summing a band FIRST and then taking its rise scored F1 0.77 (30–60Hz);
 * per-bin rise over 25–170Hz scored 0.84, because a kick landing on a
 * different bin than the sustained bass note isn't averaged away.
 */
export class OnsetTracker {
  private hist: Array<[number, Float32Array]> = [];

  constructor(
    private readonly loHz = 25,
    private readonly hiHz = 170,
    private readonly windowMs = 35,
  ) {}

  /** `freq`: byte spectrum (0..255 per bin). Returns onset strength 0..1. */
  update(freq: ArrayLike<number>, binHz: number, nowMs: number): number {
    const b0 = Math.max(1, Math.floor(this.loHz / binHz));
    const b1 = Math.min(freq.length - 1, Math.max(b0, Math.ceil(this.hiHz / binHz)));
    const cur = new Float32Array(b1 - b0 + 1);
    for (let k = b0; k <= b1; k++) cur[k - b0] = freq[k];

    let base: Float32Array | null = null;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      if (nowMs - this.hist[i][0] >= this.windowMs * 0.9) {
        base = this.hist[i][1];
        break;
      }
    }
    this.hist.push([nowMs, cur]);
    while (this.hist.length > 2 && nowMs - this.hist[0][0] > this.windowMs * 4) this.hist.shift();
    if (!base || base.length !== cur.length) return 0;

    let sum = 0;
    for (let i = 0; i < cur.length; i++) sum += Math.max(0, cur[i] - base[i]);
    return sum / (cur.length * 255);
  }

  reset(): void {
    this.hist = [];
  }
}

/**
 * Kick/beat detector → a 0..1 pulse that jumps on a hit and decays after.
 *
 * ONSET-based (spectral flux), not level-based. Tuned on a real captured
 * track: getByteFrequencyData is dB-scaled, and a loud modern master sits
 * at ~0.85 bass almost constantly — kicks only lift the LEVEL by ~0.05, so
 * "level above average" caught 2/28 kicks. What a kick does unmistakably is
 * RISE FAST: the sub band jumps ~0.17 within one frame. So a beat = the rise
 * over the last ~35ms beating the song's own typical rise (mean + k·dev,
 * tracked over ~1.5s) and an absolute minimum. On that track: 19/28 kicks
 * with 1 false hit at the default sensitivity.
 *
 * The rise is measured against the value ~`windowMs` ago rather than "the
 * previous frame", so 30fps (captured tab, via the offscreen doc) and 60fps
 * (MusicBox, local) sources behave the same.
 */
export interface BeatOptions {
  /** rise must exceed mean + k × deviation of recent rises (higher = pickier) */
  k?: number;
  /** …and at least this absolute rise (0..1) */
  minFlux?: number;
  /** rise is measured over this much time */
  windowMs?: number;
  minGapMs?: number;
  /** time constant of the rise statistics */
  statsMs?: number;
  decayMs?: number;
  /** every beat hits 1 — even pulses, instead of scaled by how hard it hit */
  uniform?: boolean;
  /**
   * Fast/dense music (drum runs, 16th-note kicks): beats may come 100ms apart
   * instead of 150ms. Measured on a 110ms drum run: 18/20 hits (dense).
   */
  dense?: boolean;
}

/**
 * Map a 1..10 "beat sensitivity" slider to detector thresholds. Calibrated
 * with OnsetTracker on a dense, bass-heavy remix (1076 reference kicks,
 * browser analyser emulated offline at maxDecibels −10): 5 ↔ k=2, the best
 * F1 (0.84: 87% of kicks found, 81% of reported beats real). Lower = pickier,
 * higher = catches softer hits at the cost of some extras.
 */
export function beatOptionsFromSensitivity(
  sensitivity: number,
  dense = false,
): Pick<BeatOptions, "k" | "minFlux" | "dense"> {
  const s = Math.min(10, Math.max(1, sensitivity)) - 1; // 0..9
  const k = s <= 4 ? 3 - s * 0.25 : 2 - (s - 4) * 0.12; // 3.0 … 2.0 (at 5) … 1.4
  return { k, minFlux: 0.05 - s * (0.03 / 9), dense };
}

export class BeatDetector {
  private hist: Array<[number, number]> = []; // [t, energy], last ~150ms
  private mean = 0;
  private dev = 0;
  private lastT: number | null = null;
  private lastBeat = -Infinity;
  private pulse = 0;
  /** re-armed once the rise falls back — one kick spread over frames = one beat */
  private armed = true;
  /** smoothed time between recent beats, to shorten the pulse in fast passages */
  private interval = 500;
  private readonly k: number;
  private readonly minFlux: number;
  private readonly windowMs: number;
  private readonly minGapMs: number;
  private readonly statsMs: number;
  private readonly decayMs: number;
  private readonly uniform: boolean;
  private readonly dense: boolean;

  constructor(opts: BeatOptions = {}) {
    this.dense = opts.dense ?? false;
    this.k = opts.k ?? 2;
    this.minFlux = opts.minFlux ?? 0.035;
    this.windowMs = opts.windowMs ?? 35;
    // 150 = best F1 on the reference remix; dense goes lower for fast drum
    // runs (doubles are prevented by re-arming either way)
    this.minGapMs = opts.minGapMs ?? (this.dense ? 100 : 150);
    this.statsMs = opts.statsMs ?? 1500;
    this.decayMs = opts.decayMs ?? 170;
    this.uniform = opts.uniform ?? false;
  }

  /** Feed a single band's energy; the rise over ~windowMs is computed here. */
  update(energy: number, nowMs: number): number {
    // value ~windowMs ago (newest sample at least that old)
    let base: number | null = null;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      if (nowMs - this.hist[i][0] >= this.windowMs * 0.9) {
        base = this.hist[i][1];
        break;
      }
    }
    this.hist.push([nowMs, energy]);
    while (this.hist.length > 2 && nowMs - this.hist[0][0] > this.windowMs * 4) this.hist.shift();
    return this.updateOnset(base === null ? 0 : Math.max(0, energy - base), nowMs);
  }

  /**
   * Feed a ready-made onset strength (0..1) — e.g. OnsetTracker's multi-bin
   * flux, which beats any single band on dense, bass-heavy music.
   */
  updateOnset(flux: number, nowMs: number): number {
    const dt = this.lastT === null ? 16 : Math.max(0, nowMs - this.lastT);
    this.lastT = nowMs;
    // in fast passages decay within ~40% of the beat spacing, so back-to-back
    // hits stay separate pulses instead of one long swell
    const decay = Math.min(this.decayMs, Math.max(50, this.interval * 0.4));
    this.pulse *= Math.exp(-dt / decay);

    const threshold = Math.max(this.minFlux, this.mean + this.k * this.dev);
    if (!this.armed && flux < threshold * 0.5) this.armed = true;
    if (this.armed && flux > threshold && nowMs - this.lastBeat >= this.minGapMs) {
      // just over the threshold → half a kick; twice the threshold or more → full
      const strength = this.uniform ? 1 : Math.min(1, Math.max(0.5, flux / (2 * threshold)));
      this.pulse = Math.max(this.pulse, strength);
      const gap = nowMs - this.lastBeat;
      if (gap < 2000) this.interval += (gap - this.interval) * 0.4;
      this.lastBeat = nowMs;
      this.armed = false;
    }

    // Statistics describe the "background" rise, so beats are clipped to the
    // threshold before entering them — otherwise busy music inflates mean/dev
    // and the threshold climbs over the kicks themselves. On the bass-heavy
    // reference remix, unclipped stats capped F1 at 0.68; clipped reached 0.84.
    const sample = Math.min(flux, threshold);
    const a = 1 - Math.exp(-dt / this.statsMs);
    this.mean += (sample - this.mean) * a;
    this.dev += (Math.abs(sample - this.mean) - this.dev) * a;
    return this.pulse;
  }

  reset(): void {
    this.hist = [];
    this.mean = 0;
    this.dev = 0;
    this.lastT = null;
    this.lastBeat = -Infinity;
    this.pulse = 0;
    this.armed = true;
    this.interval = 500;
  }
}

/** Resample `src` to `count` values by linear interpolation (bars ≠ bands). */
export function resample(src: ArrayLike<number>, count: number, out: Float32Array = new Float32Array(count)): Float32Array {
  const n = src.length;
  if (n === 0) return out.fill(0);
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0 : (i / (count - 1)) * (n - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(n - 1, i0 + 1);
    const f = x - i0;
    out[i] = src[i0] * (1 - f) + src[i1] * f;
  }
  return out;
}
