import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Compass, Palette, Search, Sparkles, Upload, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { db } from "@/core/storage/db";
import { on } from "@/core/event-bus";
import {
  CORE_FEATURE_ID,
  useFeatureValues,
  useSettingsStore,
} from "@/core/settings-engine/settingsStore";
import { getFeatures } from "@/core/feature-registry";
import { useWallpaperStore, wallpaperErrorKey } from "@/features/newtab/wallpaper/store";
import { WALLPAPER_FEATURE_ID } from "@/features/newtab/wallpaper";
import { DEFAULT_TOPIC_IDS, WALLHAVEN_TOPICS } from "@/features/newtab/wallpaper/wallhaven";
import { SEARCH_FEATURE_ID } from "@/features/newtab/search-bar";
import { hasSuggestPermission, requestSuggestPermission } from "@/features/newtab/search-bar/suggest";
import { BOOKMARK_FEATURE_ID } from "@/features/newtab/bookmark-bar";
import { requestBookmarkPermission } from "@/features/newtab/bookmark-bar/bookmarks-api";
import { CLOCK_FEATURE_ID } from "@/features/newtab/clock-weather";
import { Button, Card, Segmented, Slider, TextInput, Toggle } from "@/shared/ui";
import { ThemePicker } from "../settings/ThemePicker";
import "./onboarding.css";

/**
 * First-run wizard (docs/phase-1-mvp/02 + phase-5 §5 feature-picker step).
 * Every choice applies live behind the overlay; progress persists to
 * `onboarding-state` so closing mid-way resumes.
 */

// welcome, theme, mode, wallpaper, weather, bookmarks, features, done
const TOTAL_STEPS = 8;

export function Onboarding() {
  const { t } = useTranslation();
  const hydrated = useSettingsStore((s) => s.hydrated);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);

  useEffect(() => {
    if (!hydrated) return;
    void db.onboardingState.get("state").then((row) => {
      if (!row || !row.completed) {
        setStep(row?.step ?? 0);
        setOpen(true);
      }
    });
  }, [hydrated]);

  useEffect(
    () =>
      on("onboarding:open", () => {
        setStep(0);
        setOpen(true);
      }),
    [],
  );

  const persistStep = useCallback((s: number, completed = false) => {
    void db.onboardingState.put({ id: "state", step: s, completed, updatedAt: Date.now() });
  }, []);

  const go = (delta: number) => {
    const next = Math.min(TOTAL_STEPS - 1, Math.max(0, step + delta));
    setDir(delta >= 0 ? 1 : -1);
    setStep(next);
    persistStep(next);
  };

  const finish = () => {
    persistStep(TOTAL_STEPS - 1, true);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="onboarding-overlay">
      <Card elevated className="onboarding-card">
        <div className="onboarding-dots" aria-hidden>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={`onboarding-dots__dot ${i === step ? "onboarding-dots__dot--active" : ""}`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            className="onboarding-step"
            custom={dir}
            initial={{ opacity: 0, x: dir * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -60 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <StepContent step={step} />
          </motion.div>
        </AnimatePresence>

        <div className="onboarding-footer">
          <div className="onboarding-footer__group">
            {step > 0 && step < TOTAL_STEPS - 1 && (
              <Button variant="ghost" onClick={() => go(-1)}>
                {t("common.back")}
              </Button>
            )}
          </div>
          <div className="onboarding-footer__group">
            {step === 0 && (
              <>
                <Button variant="ghost" onClick={finish}>
                  {t("common.skipAll")}
                </Button>
                <Button variant="primary" onClick={() => go(1)}>
                  {t("common.start")}
                </Button>
              </>
            )}
            {step > 0 && step < TOTAL_STEPS - 1 && (
              <Button variant="primary" onClick={() => go(1)}>
                {t("common.next")}
              </Button>
            )}
            {step === TOTAL_STEPS - 1 && (
              <Button variant="primary" onClick={finish}>
                {t("onboarding.enter")}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function StepContent({ step }: { step: number }) {
  const { t } = useTranslation();
  const setValue = useSettingsStore((s) => s.setValue);
  const setEnabled = useSettingsStore((s) => s.setEnabled);
  const coreValues = useFeatureValues(CORE_FEATURE_ID);
  const clockValues = useFeatureValues(CLOCK_FEATURE_ID);
  const bookmarkEnabled = useSettingsStore((s) => s.enabled[BOOKMARK_FEATURE_ID] ?? true);

  switch (step) {
    case 0:
      return (
        <>
          <div className="onboarding-welcome-art" aria-hidden>
            <Sparkles size={72} style={{ color: "var(--accent)" }} />
          </div>
          <h2 className="onboarding-step__title">{t("onboarding.welcomeTitle")}</h2>
          <p className="onboarding-step__desc">{t("onboarding.welcomeBody")}</p>
        </>
      );
    case 1:
      return (
        <>
          <h2 className="onboarding-step__title">{t("onboarding.stepTheme")}</h2>
          <p className="onboarding-step__desc">{t("onboarding.stepThemeDesc")}</p>
          <ThemePicker compact />
        </>
      );
    case 2:
      return (
        <>
          <h2 className="onboarding-step__title">{t("onboarding.stepColorMode")}</h2>
          <Segmented
            value={(coreValues.colorMode as string) ?? "system"}
            onChange={(v) => setValue(CORE_FEATURE_ID, "colorMode", v)}
            options={[
              { value: "system", label: t("settings.colorModeSystem") },
              { value: "light", label: t("settings.colorModeLight") },
              { value: "dark", label: t("settings.colorModeDark") },
            ]}
          />
          <div className="onboarding-scale">
            <div className="onboarding-scale__head">
              <span className="ui-field__label">{t("settings.uiScale")}</span>
              <span className="ui-field__desc">{t("onboarding.scaleHint")}</span>
            </div>
            <Slider
              value={typeof coreValues.uiScale === "number" ? coreValues.uiScale : 100}
              onChange={(v) => setValue(CORE_FEATURE_ID, "uiScale", v)}
              min={80}
              max={130}
              step={5}
              commitOnRelease
            />
          </div>
        </>
      );
    case 3:
      return <WallpaperStep />;
    case 4:
      return (
        <>
          <h2 className="onboarding-step__title">{t("onboarding.stepWeather")}</h2>
          <p className="onboarding-step__desc">{t("onboarding.stepWeatherDesc")}</p>
          <TextInput
            placeholder={t("weather.locationPlaceholder")}
            value={(clockValues.location as string) ?? ""}
            onChange={(e) => setValue(CLOCK_FEATURE_ID, "location", e.target.value)}
          />
          <div className="ui-field__row">
            <span className="ui-field__label">{t("weather.useGeolocation")}</span>
            <Toggle
              checked={clockValues.useGeolocation === true}
              onChange={(v) => setValue(CLOCK_FEATURE_ID, "useGeolocation", v)}
            />
          </div>
        </>
      );
    case 5:
      return (
        <>
          <h2 className="onboarding-step__title">{t("onboarding.stepBookmarks")}</h2>
          <p className="onboarding-step__desc">
            {t("onboarding.stepBookmarksDesc")} {t("bookmarks.firstTimeNote")}
          </p>
          <div className="ui-field__row">
            <span className="ui-field__label">{t("onboarding.stepBookmarksEnable")}</span>
            <Toggle
              checked={bookmarkEnabled}
              onChange={async (v) => {
                setEnabled(BOOKMARK_FEATURE_ID, v);
                if (v) await requestBookmarkPermission();
              }}
            />
          </div>
        </>
      );
    case 6:
      return <FeaturesStep />;
    default:
      return (
        <>
          <h2 className="onboarding-step__title">{t("onboarding.doneTitle")}</h2>
          <p className="onboarding-step__desc">{t("onboarding.doneBody")}</p>
        </>
      );
  }
}

type WallpaperChoice = "wallhaven" | "gradient" | "upload";

/** Step 3 — Wallhaven (random, with topics), theme gradient, or own image. */
function WallpaperStep() {
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

/** Off-by-default features worth suggesting on day one. */
const RECOMMENDED_FEATURES = ["daily-quote", "panel-calendar", "tool-translate", "tool-qr"];

/** Step 6 — recommended picks first (incl. search suggestions), then everything else. */
function FeaturesStep() {
  const { t } = useTranslation();
  const setEnabled = useSettingsStore((s) => s.setEnabled);
  const setValue = useSettingsStore((s) => s.setValue);
  const enabledMap = useSettingsStore((s) => s.enabled);
  const searchValues = useFeatureValues(SEARCH_FEATURE_ID);
  const [suggestGranted, setSuggestGranted] = useState(false);

  useEffect(() => {
    void hasSuggestPermission().then(setSuggestGranted);
  }, []);

  const all = getFeatures().filter(
    (f) => f.zone === "left-sidebar" || f.zone === "right-sidebar" || f.zone === "center",
  );
  const recommended = RECOMMENDED_FEATURES.map((id) => all.find((f) => f.id === id)).filter(
    (f): f is NonNullable<typeof f> => !!f,
  );
  const others = all.filter((f) => !RECOMMENDED_FEATURES.includes(f.id));
  const isOn = (f: (typeof all)[number]) => enabledMap[f.id] ?? f.defaultEnabled;

  const suggestOn = searchValues.suggestions !== false && suggestGranted;
  // the permission prompt needs the click's user gesture — call it first, synchronously
  const setSuggest = (v: boolean) => {
    setValue(SEARCH_FEATURE_ID, "suggestions", v);
    if (v) void requestSuggestPermission().then(setSuggestGranted);
  };

  const enableAllRecommended = () => {
    if (!suggestOn) setSuggest(true);
    for (const f of recommended) setEnabled(f.id, true);
  };
  const allRecommendedOn = suggestOn && recommended.every(isOn);

  const row = (f: (typeof all)[number], rec = false) => (
    <div className={`onboarding-feature ${rec ? "onboarding-feature--rec" : ""}`} key={f.id}>
      <span className="onboarding-feature__name">
        <f.icon size={16} /> {t(f.nameKey)}
      </span>
      <Toggle checked={isOn(f)} onChange={(v) => setEnabled(f.id, v)} />
    </div>
  );

  return (
    <>
      <h2 className="onboarding-step__title">{t("onboarding.stepFeatures")}</h2>
      <p className="onboarding-step__desc">{t("onboarding.stepFeaturesDesc")}</p>
      <div className="onboarding-features">
        <div className="onboarding-features__head">
          <span className="onboarding-features__group">
            <Sparkles size={13} /> {t("onboarding.recommended")}
          </span>
          <Button size="sm" variant="primary" disabled={allRecommendedOn} onClick={enableAllRecommended}>
            {t("onboarding.enableRecommended")}
          </Button>
        </div>
        <div className="onboarding-feature onboarding-feature--rec">
          <span className="onboarding-feature__name">
            <Search size={16} /> {t("search.suggestions")}
          </span>
          <Toggle checked={suggestOn} onChange={setSuggest} />
        </div>
        {recommended.map((f) => row(f, true))}
        <span className="onboarding-features__group">{t("onboarding.allFeatures")}</span>
        {others.map((f) => row(f))}
      </div>
    </>
  );
}
