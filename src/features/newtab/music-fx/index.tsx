import { useEffect, useRef } from "react";
import { AudioLines } from "lucide-react";
import { registerFeature } from "@/core/feature-registry";
import { CORE_FEATURE_ID, useFeatureValues } from "@/core/settings-engine/settingsStore";
import { subscribeAudioFrames } from "@/core/audio-signal";
import { connectCapturedTabSource } from "@/core/audio-signal/channel";
import { BeatDetector, beatOptionsFromSensitivity, resample } from "@/core/audio-signal/engine";
import { drawViz, type VizMode, type VizPaint } from "./draw";
import { musicFxSettingsSchema } from "./settings.schema";
import "./music-fx.css";

export const MUSIC_FX_FEATURE_ID = "music-fx";

/**
 * Music effects (docs: plan "Hiệu ứng âm nhạc", phases 1–2): a visualizer
 * overlay and a bass-driven wallpaper pulse, both fed by core/audio-signal —
 * today that's MusicBox; captured browser tabs plug into the same bus later.
 * Both stay idle (nothing drawn, nothing moved) while no audio plays.
 */

type Position = "bottom" | "top" | "center" | "full";

const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);

/** The theme accent as rgb() + a lighter tint — canvas needs literal colors. */
function resolveAccent(): { accent: string; accentLight: string } {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;color:var(--accent)";
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return { accent: "#38bdf8", accentLight: "#bae6fd" };
  const [r, g, b] = m.slice(0, 3).map(Number);
  const lift = (c: number) => Math.round(c + (255 - c) * 0.45);
  return { accent: `rgb(${r} ${g} ${b})`, accentLight: `rgb(${lift(r)} ${lift(g)} ${lift(b)})` };
}

function Visualizer({ values }: { values: Record<string, unknown> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const core = useFeatureValues(CORE_FEATURE_ID);

  const mode = ((values.vizMode as string) ?? "bars") as VizMode;
  const position = ((values.vizPosition as string) ?? "bottom") as Position;
  const layer = values.vizLayer === "behind" ? "behind" : "above";
  const height = num(values.vizHeight, 140);
  const opacity = num(values.vizOpacity, 80) / 100;

  // everything the draw loop reads lives in a ref, so changing a setting
  // doesn't tear down and resubscribe the loop
  const opts = useRef({
    bars: 64,
    sensitivity: 1,
    paint: {} as VizPaint,
  });
  opts.current.bars = num(values.vizBars, 64);
  opts.current.sensitivity = num(values.vizSensitivity, 100) / 100;
  opts.current.paint = {
    ...opts.current.paint,
    mode,
    anchor: position === "top" ? "top" : "bottom",
    color: (values.vizColor as VizPaint["color"]) ?? "accent",
    color1: (values.vizColor1 as string) ?? "#38bdf8",
    color2: (values.vizColor2 as string) ?? "#c084fc",
  };

  // re-read the accent when the theme / color mode changes. One frame later:
  // this child effect runs BEFORE App's theme effect writes the new CSS vars.
  const themeKey = `${core.themeId}|${core.colorMode}`;
  useEffect(() => {
    const id = requestAnimationFrame(() => Object.assign(opts.current.paint, resolveAccent()));
    return () => cancelAnimationFrame(id);
  }, [themeKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !wrap || !ctx) return;

    let w = 0;
    let h = 0;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    let bars = new Float32Array(opts.current.bars);
    let idle = true;
    const start = performance.now();
    const unsubscribe = subscribeAudioFrames((frame) => {
      const o = opts.current;
      if (bars.length !== o.bars) bars = new Float32Array(o.bars);
      resample(frame.bands, o.bars, bars);
      for (let i = 0; i < bars.length; i++) bars[i] = Math.min(1, bars[i] * o.sensitivity);
      o.paint.time = (performance.now() - start) / 1000;
      drawViz(ctx, bars, w, h, o.paint);
      // fade the layer out while silent (class flips only on change)
      if (idle === frame.active) {
        idle = !frame.active;
        wrap.classList.toggle("music-fx--idle", idle);
      }
    });

    return () => {
      unsubscribe();
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className={`music-fx music-fx--${position} music-fx--${layer} music-fx--idle`}
      style={{ "--viz-h": `${height}px`, "--viz-opacity": opacity } as React.CSSProperties}
      aria-hidden
    >
      <canvas ref={canvasRef} className="music-fx__canvas" />
    </div>
  );
}

/**
 * Bass pulse: writes `--music-pulse` on elements that opted in with
 * `data-music-pulse` (the wallpaper layer does). The wallpaper owns HOW it
 * reacts (a GPU-only scale in its CSS) — this feature never reaches into it.
 */
function WallpaperPulse({
  strength,
  sensitivity,
  even,
  dense,
}: {
  strength: number;
  /** 1..10 — how easily a bass hit counts as a beat */
  sensitivity: number;
  /** every beat the same size, no bass "breathing" in between */
  even: boolean;
  /** fast/dense music: beats may come ~100ms apart */
  dense: boolean;
}) {
  useEffect(() => {
    // 1 → 0.8%, 10 → 8% zoom on a kick (4% max read as "barely moves")
    const amp = strength * 0.008;
    // own detector, tuned by the user — the bus's shared one has fixed thresholds.
    // Slower decay than the visualizer's: a 170ms blink was too short to see.
    const detector = new BeatDetector({ ...beatOptionsFromSensitivity(sensitivity, dense), uniform: even, decayMs: 280 });
    let targets: HTMLElement[] = [];
    let lastLookup = 0;
    let last = -1;
    const unsubscribe = subscribeAudioFrames((frame) => {
      const now = performance.now();
      if (now - lastLookup > 1000) {
        // wallpaper may mount/unmount; re-find cheaply once a second
        targets = Array.from(document.querySelectorAll<HTMLElement>("[data-music-pulse]"));
        lastLookup = now;
      }
      const beat = detector.updateOnset(frame.onset, now);
      // "dynamic" also follows the bass level between kicks; "even" is kicks only
      const v = Math.round((beat * amp + (even ? 0 : frame.bass * amp * 0.35)) * 10000) / 10000;
      if (v === last) return;
      last = v;
      for (const el of targets) el.style.setProperty("--music-pulse", String(v));
    });
    return () => {
      unsubscribe();
      for (const el of document.querySelectorAll<HTMLElement>("[data-music-pulse]")) {
        el.style.removeProperty("--music-pulse");
      }
    };
  }, [strength, sensitivity, even, dense]);
  return null;
}

/** Listen to a browser tab captured via the popup / Alt+Shift+V (offscreen → BroadcastChannel). */
function CapturedTabSource() {
  useEffect(() => connectCapturedTabSource(), []);
  return null;
}

function MusicFx() {
  const values = useFeatureValues(MUSIC_FX_FEATURE_ID);
  const core = useFeatureValues(CORE_FEATURE_ID);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // motion-heavy by nature: off in low-power mode and for reduced-motion users
  if (core.lowPower === true || reducedMotion) return null;

  return (
    <>
      <CapturedTabSource />
      {values.vizEnabled !== false && <Visualizer values={values} />}
      {values.pulseEnabled !== false && (
        <WallpaperPulse
          strength={num(values.pulseStrength, 5)}
          sensitivity={num(values.pulseSensitivity, 5)}
          even={values.pulseStyle !== "dynamic"}
          dense={values.pulseDensity === "dense"}
        />
      )}
    </>
  );
}

registerFeature({
  id: MUSIC_FX_FEATURE_ID,
  zone: "background",
  nameKey: "features.music-fx",
  icon: AudioLines,
  // opt-in: motion-heavy, and tab capture shows the browser's "sharing" dot
  defaultEnabled: false,
  settingsSchema: musicFxSettingsSchema,
  component: MusicFx,
  order: 5,
});

export default MusicFx;
