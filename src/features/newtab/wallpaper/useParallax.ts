import { useEffect, type RefObject } from "react";

/**
 * Parallax: the wallpaper shifts slightly opposite the pointer (via
 * --parallax-x/y on `ref`). With `idleSway`, once the mouse rests it drifts on
 * its own along a slow, never-repeating path (two sines per axis, random
 * phases per tab). One rAF loop eases toward whichever target applies —
 * frame-rate independent, and it stops writing once settled.
 */
export function useParallax(ref: RefObject<HTMLElement>, on: boolean, idleSway: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) {
      el?.style.removeProperty("--parallax-x");
      el?.style.removeProperty("--parallax-y");
      return;
    }
    const MAX = 14; // px at the screen edge
    const IDLE_AFTER = 2500; // ms without mouse movement
    const ph = Array.from({ length: 4 }, () => Math.random() * Math.PI * 2);
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let lastMove = performance.now();
    let lastT = 0;
    let raf = 0;

    const onMove = (e: MouseEvent) => {
      tx = -(e.clientX / window.innerWidth - 0.5) * 2;
      ty = -(e.clientY / window.innerHeight - 0.5) * 2;
      lastMove = performance.now();
    };
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastT ? Math.min(100, t - lastT) : 16;
      lastT = t;
      const idle = idleSway && t - lastMove > IDLE_AFTER;
      if (idle) {
        const s = t / 1000;
        tx = 0.55 * Math.sin(s * 0.21 + ph[0]) + 0.3 * Math.sin(s * 0.083 + ph[1]);
        ty = 0.55 * Math.sin(s * 0.17 + ph[2]) + 0.3 * Math.sin(s * 0.061 + ph[3]);
      }
      // quick follow for the mouse, lazy glide for the drift (and the hand-over)
      const k = 1 - Math.exp(-dt / (idle ? 900 : 120));
      const nx = x + (tx - x) * k;
      const ny = y + (ty - y) * k;
      if (Math.abs(nx - x) * MAX < 0.01 && Math.abs(ny - y) * MAX < 0.01) return; // settled
      x = nx;
      y = ny;
      el.style.setProperty("--parallax-x", `${(x * MAX).toFixed(2)}px`);
      el.style.setProperty("--parallax-y", `${(y * MAX).toFixed(2)}px`);
    };
    window.addEventListener("mousemove", onMove);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [ref, on, idleSway]);
}
