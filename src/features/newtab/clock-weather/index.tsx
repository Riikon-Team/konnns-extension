import { useEffect } from "react";
import { Clock as ClockIcon } from "lucide-react";
import { registerFeature } from "@/core/feature-registry";
import { useFeatureValues } from "@/core/settings-engine/settingsStore";
import { AnalogClock, DigitalClock, TextClock } from "./clocks";
import { CustomClock, DEFAULT_CLOCK_CSS } from "./CustomClock";
import { useCustomClockStore } from "./customClockStore";
import { ClockPresetManager } from "./ClockPresetManager";
import { clockWeatherSettingsSchema } from "./settings.schema";
import "./clock-weather.css";

/** id kept as "clock-weather" so existing clock settings survive; weather
 *  itself moved to its own feature (features/newtab/weather). */
export const CLOCK_FEATURE_ID = "clock-weather";

interface ClockValues {
  [key: string]: unknown;
  clockStyle?: string;
  showSeconds?: boolean;
  hour24?: boolean;
}

function ClockWeather() {
  const values = useFeatureValues<ClockValues>(CLOCK_FEATURE_ID);
  const style = values.clockStyle ?? "digital";
  const showSeconds = values.showSeconds === true;
  const hour24 = values.hour24 !== false;

  const customLoaded = useCustomClockStore((s) => s.loaded);
  const customItems = useCustomClockStore((s) => s.items);
  const loadCustom = useCustomClockStore((s) => s.load);
  useEffect(() => {
    if (style === "custom" && !customLoaded) void loadCustom();
  }, [style, customLoaded, loadCustom]);

  const activeCss =
    customItems.find((c) => c.id === (values.customClockId as string))?.css ??
    customItems[0]?.css ??
    DEFAULT_CLOCK_CSS;

  return (
    <div>
      {style === "analog" ? (
        <AnalogClock showSeconds={showSeconds} />
      ) : style === "text" ? (
        <TextClock hour24={hour24} />
      ) : style === "custom" ? (
        <CustomClock css={activeCss} />
      ) : (
        <DigitalClock showSeconds={showSeconds} hour24={hour24} />
      )}
    </div>
  );
}

registerFeature({
  id: CLOCK_FEATURE_ID,
  zone: "center",
  nameKey: "features.clock-weather",
  icon: ClockIcon,
  defaultEnabled: true,
  requiresNetwork: true,
  settingsSchema: clockWeatherSettingsSchema,
  settingsExtra: ClockPresetManager,
  component: ClockWeather,
  order: 1,
});

export default ClockWeather;
