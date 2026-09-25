import { useEffect, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFeatureValues, useSettingsStore } from "@/core/settings-engine/settingsStore";
import { getFeatures } from "@/core/feature-registry";
import { SEARCH_FEATURE_ID } from "@/features/newtab/search-bar";
import { hasSuggestPermission, requestSuggestPermission } from "@/features/newtab/search-bar/suggest";
import { Button, Toggle } from "@/shared/ui";
/** Off-by-default features worth suggesting on day one. */
const RECOMMENDED_FEATURES = ["daily-quote", "panel-calendar", "tool-translate", "tool-qr"];

/** Step 6 — recommended picks first (incl. search suggestions), then everything else. */
export function FeaturesStep() {
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
