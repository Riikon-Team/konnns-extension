import { useEffect } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Moon,
  Snowflake,
  Sun,
  WifiOff,
  Wind,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerFeature } from "@/core/feature-registry";
import { useFeatureValues, useSettingsStore } from "@/core/settings-engine/settingsStore";
import { useLeftSidebar } from "@/core/layout-engine/leftSidebar";
import { emit } from "@/core/event-bus";
import { useOnlineStatus } from "@/core/net";
import { Skeleton } from "@/shared/ui";
import { describeWeatherCode, useWeatherStore } from "./weather";
import { weatherSettingsSchema } from "./settings.schema";
import "./weather.css";

/**
 * Weather — its own feature (split out of "Clock & Weather") so it can be
 * switched off on its own and placed either right under the search bar or as
 * a small bubble in the top-left corner. Location settings live here; the
 * detailed weather panel reads them from this feature too.
 */
export const WEATHER_FEATURE_ID = "weather";
const LEGACY_CLOCK_ID = "clock-weather";

interface WeatherValues {
  [key: string]: unknown;
  display?: string;
  useGeolocation?: boolean;
  location?: string;
}

const weatherIcons: Record<string, typeof Sun> = {
  clear: Sun,
  "clear-night": Moon,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: Snowflake,
  showers: CloudRain,
  thunder: CloudLightning,
};

function WeatherSummary({ values, compact = false }: { values: WeatherValues; compact?: boolean }) {
  const { t } = useTranslation();
  const { status, data, offline, fetch } = useWeatherStore();
  const online = useOnlineStatus();
  const city = values.location ?? "";
  const useGeo = values.useGeolocation === true;
  const cls = `weather-summary ${compact ? "weather-summary--compact" : ""}`;
  const openSettings = () => emit("settings:open", { featureId: WEATHER_FEATURE_ID });

  // refetch on location change and whenever the connection is (re)established
  useEffect(() => {
    void fetch({ city, useGeolocation: useGeo });
  }, [city, useGeo, online, fetch]);

  if (!useGeo && !city.trim()) {
    // graceful "not configured" placeholder — never raw errors (docs/phase-1-mvp/01 §2)
    return (
      <div className={cls}>
        <button className="weather-summary__setup" onClick={openSettings}>
          {t("weather.notConfigured")} — {t("weather.configure")}
        </button>
      </div>
    );
  }

  if (status === "loading" || status === "idle") {
    return (
      <div className={cls} aria-hidden>
        <Skeleton width={compact ? 120 : 200} height={compact ? 22 : 28} radius="var(--radius-full)" />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className={cls}>
        <button className="weather-summary__setup" onClick={openSettings}>
          {t("weather.error")} — {t("weather.configure")}
        </button>
      </div>
    );
  }

  const desc = describeWeatherCode(data.weatherCode);
  const iconKey = desc.bucket === "clear" && !data.isDay ? "clear-night" : desc.bucket;
  const Icon = weatherIcons[iconKey] ?? Cloud;

  return (
    <div className={cls}>
      <Icon size={compact ? 20 : 26} className="weather-summary__icon" aria-hidden />
      <span className="weather-summary__temp">{data.temperature}°C</span>
      <span>{t(desc.labelKey)}</span>
      <span className="weather-summary__meta">
        <Wind size={compact ? 12 : 14} style={{ verticalAlign: "-2px" }} aria-hidden /> {data.windSpeed} km/h
        {data.locationLabel ? ` · ${data.locationLabel}` : ""}
      </span>
      {offline && (
        <span className="weather-summary__offline" title={t("weather.offline")}>
          <WifiOff size={14} aria-hidden /> {t("weather.offline")}
        </span>
      )}
    </div>
  );
}

/** Center zone, right under the search bar ("below" mode). */
function WeatherInline() {
  const values = useFeatureValues<WeatherValues>(WEATHER_FEATURE_ID);
  if (values.display === "bubble") return null;
  return <WeatherSummary values={values} />;
}

/** Top-left bubble ("bubble" mode); steps aside while a left panel is open. */
function WeatherBubble() {
  const values = useFeatureValues<WeatherValues>(WEATHER_FEATURE_ID);
  const panelOpen = useLeftSidebar((s) => s.open.length > 0);
  if (values.display !== "bubble") return null;
  // "panel" (default) inherits the panel glass via CSS vars; "custom" overrides it here
  const custom = values.bubbleBg === "custom";
  const opacity = typeof values.bubbleOpacity === "number" ? values.bubbleOpacity : 60;
  const blur = typeof values.bubbleBlur === "number" ? values.bubbleBlur : 12;
  const style: React.CSSProperties | undefined = custom
    ? {
        background: `color-mix(in srgb, var(--surface-elevated) ${opacity}%, transparent)`,
        backdropFilter: blur > 0 ? `blur(${blur}px)` : "none",
        borderColor: opacity === 0 ? "transparent" : undefined,
        boxShadow: opacity === 0 ? "none" : undefined,
      }
    : undefined;
  return (
    <div
      className={`weather-bubble ${panelOpen ? "weather-bubble--hidden" : ""}`}
      style={style}
      aria-hidden={panelOpen}
    >
      <WeatherSummary values={values} compact />
    </div>
  );
}

/**
 * One-time migration from "Clock & Weather": carry over the location and
 * GPS choice, and if weather had been switched off there, start disabled.
 */
let migrationChecked = false;
const stopMigration = useSettingsStore.subscribe((s) => {
  if (!s.hydrated || migrationChecked) return;
  migrationChecked = true;
  queueMicrotask(() => stopMigration());
  const w = s.values[WEATHER_FEATURE_ID] ?? {};
  if (w.migratedFromClock === true) return;
  const clock = s.values[LEGACY_CLOCK_ID] ?? {};
  const patch: Record<string, unknown> = { migratedFromClock: true };
  if (typeof clock.location === "string" && clock.location && !w.location) patch.location = clock.location;
  if (clock.useGeolocation === true) patch.useGeolocation = true;
  s.setValues(WEATHER_FEATURE_ID, patch);
  if (clock.showWeather === false) s.setEnabled(WEATHER_FEATURE_ID, false);
});

registerFeature({
  id: WEATHER_FEATURE_ID,
  zone: "center",
  nameKey: "features.weather",
  icon: CloudSun,
  defaultEnabled: true,
  requiresNetwork: true,
  settingsSchema: weatherSettingsSchema,
  component: WeatherInline,
  overlay: WeatherBubble,
  order: 2.5, // after the search bar (2), before most-visited (3)
});

export default WeatherInline;
