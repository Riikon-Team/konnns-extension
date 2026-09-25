import { useRef, useState } from "react";
import { Compass, Palette, Upload, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFeatureValues, useSettingsStore } from "@/core/settings-engine/settingsStore";
import { useWallpaperStore, wallpaperErrorKey } from "@/features/newtab/wallpaper/store";
import { WALLPAPER_FEATURE_ID } from "@/features/newtab/wallpaper";
import { DEFAULT_TOPIC_IDS, WALLHAVEN_TOPICS } from "@/features/newtab/wallpaper/wallhaven";
type WallpaperChoice = "wallhaven" | "gradient" | "upload";

/** Step 3 — Wallhaven (random, with topics), theme gradient, or own image. */
export function WallpaperStep() {
  const { t } = useTranslation();
  const setValues = useSettingsStore((s) => s.setValues);
  const values = useFeatureValues(WALLPAPER_FEATURE_ID);
  const addImageFile = useWallpaperStore((s) => s.addImageFile);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const choice: WallpaperChoice =
    values.randomMode === "wallhaven" && values.mode !== "slideshow"
      ? "wallhaven"
      : values.activeId
        ? "upload"
        : "gradient";
  const topics = Array.isArray(values.wallhavenTopics)
    ? (values.wallhavenTopics as string[])
    : DEFAULT_TOPIC_IDS;

  const options: Array<{ id: WallpaperChoice; icon: LucideIcon; title: string; desc: string }> = [
    { id: "wallhaven", icon: Compass, title: t("onboarding.wpWallhaven"), desc: t("onboarding.wpWallhavenDesc") },
    { id: "gradient", icon: Palette, title: t("onboarding.stepWallpaperGradient"), desc: t("onboarding.wpGradientDesc") },
    { id: "upload", icon: Upload, title: t("wallpaper.upload"), desc: t("onboarding.wpUploadDesc") },
  ];

  const pick = (id: WallpaperChoice) => {
    setUploadError(null);
    if (id === "wallhaven") setValues(WALLPAPER_FEATURE_ID, { mode: "static", randomMode: "wallhaven" });
    else if (id === "gradient") setValues(WALLPAPER_FEATURE_ID, { randomMode: "off", activeId: "" });
    else fileRef.current?.click();
  };

  return (
    <>
      <h2 className="onboarding-step__title">{t("onboarding.stepWallpaper")}</h2>
      <p className="onboarding-step__desc">{t("onboarding.stepWallpaperDesc")}</p>
      <div className="onboarding-wp" role="radiogroup">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={choice === o.id}
            className={`onboarding-wp__opt ${choice === o.id ? "onboarding-wp__opt--on" : ""}`}
            onClick={() => pick(o.id)}
          >
            <o.icon size={20} />
            <span className="onboarding-wp__title">{o.title}</span>
            <span className="onboarding-wp__desc">{o.desc}</span>
          </button>
        ))}
      </div>

      {choice === "wallhaven" && (
        <div className="onboarding-wp__topics">
          <span className="ui-field__label">{t("wallpaper.wallhavenTopics")}</span>
          <div className="ui-checkchips">
            {WALLHAVEN_TOPICS.map((tp) => {
              const on = topics.includes(tp.id);
              return (
                <label key={tp.id} className={`ui-checkchip ${on ? "ui-checkchip--on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={on && topics.length <= 1}
                    onChange={() =>
                      setValues(WALLPAPER_FEATURE_ID, {
                        wallhavenTopics: on ? topics.filter((x) => x !== tp.id) : [...topics, tp.id],
                      })
                    }
                  />
                  <span aria-hidden>{tp.icon}</span>
                  {t(`wallpaper.topics.${tp.id}`)}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {uploadError && <div className="ui-field__error">{uploadError}</div>}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const id = await addImageFile(f);
            setValues(WALLPAPER_FEATURE_ID, { randomMode: "off", activeId: id });
          } catch (err) {
            setUploadError(t(wallpaperErrorKey(err)));
          }
        }}
      />
    </>
  );
}
