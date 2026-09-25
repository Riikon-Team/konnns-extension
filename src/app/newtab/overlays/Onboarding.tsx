import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { db } from "@/core/storage/db";
import { on } from "@/core/event-bus";
import {
  CORE_FEATURE_ID,
  useFeatureValues,
  useSettingsStore,
} from "@/core/settings-engine/settingsStore";
import { BOOKMARK_FEATURE_ID } from "@/features/newtab/bookmark-bar";
import { requestBookmarkPermission } from "@/features/newtab/bookmark-bar/bookmarks-api";
import { WEATHER_FEATURE_ID } from "@/features/newtab/weather";
import { Button, Card, Segmented, Slider, TextInput, Toggle } from "@/shared/ui";
import { ThemePicker } from "../settings/ThemePicker";
import { WallpaperStep } from "./WallpaperStep";
import { FeaturesStep } from "./FeaturesStep";
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
  const weatherValues = useFeatureValues(WEATHER_FEATURE_ID);
  const weatherEnabled = useSettingsStore((s) => s.enabled[WEATHER_FEATURE_ID] ?? true);
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
          <Segmented
            value={weatherEnabled ? ((weatherValues.display as string) ?? "below") : "off"}
            onChange={(v) => {
              setEnabled(WEATHER_FEATURE_ID, v !== "off");
              if (v !== "off") setValue(WEATHER_FEATURE_ID, "display", v);
            }}
            options={[
              { value: "below", label: t("weather.displayBelow") },
              { value: "bubble", label: t("weather.displayBubble") },
              { value: "off", label: t("weather.displayOff") },
            ]}
          />
          {weatherEnabled && (
            <>
              <TextInput
                placeholder={t("weather.locationPlaceholder")}
                value={(weatherValues.location as string) ?? ""}
                onChange={(e) => setValue(WEATHER_FEATURE_ID, "location", e.target.value)}
              />
              <div className="ui-field__row">
                <span className="ui-field__label">{t("weather.useGeolocation")}</span>
                <Toggle
                  checked={weatherValues.useGeolocation === true}
                  onChange={(v) => setValue(WEATHER_FEATURE_ID, "useGeolocation", v)}
                />
              </div>
            </>
          )}
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
