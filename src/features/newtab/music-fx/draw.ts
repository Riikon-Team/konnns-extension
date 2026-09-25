/**
 * Canvas painters for the visualizer. `values` are the bars (0..1) already
 * resampled to the wanted count; sizes are in CSS pixels (the caller has
 * applied the devicePixelRatio transform).
 */

export type VizMode = "bars" | "mirror" | "wave" | "glow" | "circle" | "dots";

export interface VizPaint {
  mode: VizMode;
  /** bars grow away from this edge; "top" flips vertically */
  anchor: "bottom" | "top";
  color: "accent" | "rainbow" | "custom";
  /** resolved rgb() strings — canvas can't take var()/color-mix() */
  accent: string;
  accentLight: string;
  color1: string;
  color2: string;
  /** seconds, drives the slow rainbow drift */
  time: number;
}

function paintFor(ctx: CanvasRenderingContext2D, w: number, h: number, p: VizPaint): string | CanvasGradient {
  if (p.color === "custom") {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, p.color1);
    g.addColorStop(1, p.color2);
    return g;
  }
  if (p.color === "rainbow") {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    const shift = (p.time * 24) % 360;
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(shift + i * 50) % 360} 90% 62%)`);
    return g;
  }
  // accent: solid at the tips, fading toward the anchor edge
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, p.accent);
  g.addColorStop(1, p.accentLight);
  return g;
}

function roundedBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = Math.min(w / 2, h / 2, 4);
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, [r, r, 0, 0]);
  else ctx.rect(x, y, w, h);
}

function drawBars(ctx: CanvasRenderingContext2D, v: Float32Array, w: number, h: number, mirror: boolean) {
  const n = v.length;
  const slot = w / n;
  const bw = Math.max(1, slot * 0.72);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = i * slot + (slot - bw) / 2;
    if (mirror) {
      const bh = Math.max(2, v[i] * h * 0.95);
      ctx.rect(x, (h - bh) / 2, bw, bh);
    } else {
      const bh = Math.max(2, v[i] * h * 0.95);
      roundedBar(ctx, x, h - bh, bw, bh);
    }
  }
  ctx.fill();
}

function wavePath(ctx: CanvasRenderingContext2D, v: Float32Array, w: number, h: number) {
  const n = v.length;
  const step = w / (n - 1);
  const y = (i: number) => h - v[i] * h * 0.9 - 1;
  ctx.moveTo(0, y(0));
  for (let i = 1; i < n; i++) {
    // midpoint quadratic smoothing: a curve through the bars, not a zig-zag
    const xm = (i - 0.5) * step;
    const ym = (y(i - 1) + y(i)) / 2;
    ctx.quadraticCurveTo((i - 1) * step, y(i - 1), xm, ym);
  }
  ctx.lineTo(w, y(n - 1));
}

function drawWave(ctx: CanvasRenderingContext2D, v: Float32Array, w: number, h: number, glow: boolean, stroke: string | CanvasGradient) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (!glow) {
    ctx.beginPath();
    wavePath(ctx, v, w, h);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.globalAlpha = 0.28;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  wavePath(ctx, v, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = glow ? 3 : 2;
  if (glow) {
    ctx.shadowBlur = 14;
    ctx.shadowColor = typeof stroke === "string" ? stroke : "rgba(255,255,255,0.8)";
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawDots(ctx: CanvasRenderingContext2D, v: Float32Array, w: number, h: number) {
  const n = v.length;
  const slot = w / n;
  const r = Math.max(1.5, Math.min(slot * 0.32, 5));
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const cx = i * slot + slot / 2;
    const cy = h - r - v[i] * (h - 2 * r) * 0.95;
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

function drawCircle(ctx: CanvasRenderingContext2D, v: Float32Array, w: number, h: number) {
  const n = v.length;
  const size = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r0 = size * 0.24;
  const len = size * 0.24;
  const total = n * 2; // mirrored halves → symmetric ring, bass at the top
  const bw = Math.max(1.5, ((Math.PI * 2 * r0) / total) * 0.6);
  ctx.lineWidth = bw;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let k = 0; k < total; k++) {
    const i = k < n ? k : total - 1 - k;
    const a = -Math.PI / 2 + (k / total) * Math.PI * 2;
    const l = 2 + v[i] * len;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.moveTo(cx + cos * r0, cy + sin * r0);
    ctx.lineTo(cx + cos * (r0 + l), cy + sin * (r0 + l));
  }
  ctx.stroke();
}

export function drawViz(ctx: CanvasRenderingContext2D, v: Float32Array, w: number, h: number, p: VizPaint): void {
  ctx.clearRect(0, 0, w, h);
  const paint = paintFor(ctx, w, h, p);
  ctx.fillStyle = paint;
  ctx.strokeStyle = paint;

  if (p.mode === "circle") {
    drawCircle(ctx, v, w, h);
    return;
  }

  ctx.save();
  if (p.anchor === "top" && p.mode !== "mirror") {
    ctx.translate(0, h);
    ctx.scale(1, -1);
  }
  switch (p.mode) {
    case "mirror":
      drawBars(ctx, v, w, h, true);
      break;
    case "wave":
      drawWave(ctx, v, w, h, false, paint);
      break;
    case "glow":
      drawWave(ctx, v, w, h, true, p.color === "accent" ? p.accent : paint);
      break;
    case "dots":
      drawDots(ctx, v, w, h);
      break;
    default:
      drawBars(ctx, v, w, h, false);
  }
  ctx.restore();
}
