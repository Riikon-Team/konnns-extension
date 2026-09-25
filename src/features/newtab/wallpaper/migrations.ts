import { CORE_FEATURE_ID, useSettingsStore } from "@/core/settings-engine/settingsStore";
import { WALLPAPER_FEATURE_ID } from "./id";

/* Side-effect module: imported once by ./index. */

// Parallax, dim and blur used to live in Appearance (core); carry them over
// once each (separate flags: parallax moved in an earlier release).
let appearanceMigrated = false;
const stopAppearanceMigration = useSettingsStore.subscribe((s) => {
  if (!s.hydrated || appearanceMigrated) return;
  appearanceMigrated = true;
  queueMicrotask(() => stopAppearanceMigration());
  const wp = s.values[WALLPAPER_FEATURE_ID] ?? {};
  const core = s.values[CORE_FEATURE_ID] ?? {};
  const patch: Record<string, unknown> = {};
  if (wp.parallaxMigrated !== true) {
    patch.parallaxMigrated = true;
    if (core.parallax === true) patch.parallax = true;
  }
  if (wp.dimBlurMigrated !== true) {
    patch.dimBlurMigrated = true;
    if (typeof core.bgDim === "number") patch.bgDim = core.bgDim;
    if (typeof core.bgBlur === "number") patch.bgBlur = core.bgBlur;
  }
  if (Object.keys(patch).length > 0) s.setValues(WALLPAPER_FEATURE_ID, patch);
});
