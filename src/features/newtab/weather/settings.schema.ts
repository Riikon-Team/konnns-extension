import { defineSchema } from "@/core/settings-engine/schema";

export const weatherSettingsSchema = defineSchema({
  display: {
    type: "select",
    label: "weather.display",
    options: [
      { value: "below", label: "weather.displayBelow" },
      { value: "bubble", label: "weather.displayBubble" },
    ],
    default: "below",
  },
  bubbleBg: {
    type: "select",
    label: "weather.bubbleBg",
    options: [
      { value: "panel", label: "weather.bubbleBgPanel" },
      { value: "custom", label: "weather.bubbleBgCustom" },
    ],
    default: "panel",
    showIf: (v) => v.display === "bubble",
  },
  bubbleOpacity: {
    type: "slider",
    label: "weather.bubbleOpacity",
    min: 0,
    max: 100,
    step: 5,
    default: 60,
    showIf: (v) => v.display === "bubble" && v.bubbleBg === "custom",
  },
  bubbleBlur: {
    type: "slider",
    label: "weather.bubbleBlur",
    min: 0,
    max: 30,
    step: 1,
    default: 12,
    showIf: (v) => v.display === "bubble" && v.bubbleBg === "custom",
  },
  useGeolocation: {
    type: "toggle",
    label: "weather.useGeolocation",
    default: false,
  },
  location: {
    type: "text",
    label: "weather.location",
    placeholder: "weather.locationPlaceholder",
    showIf: (v) => v.useGeolocation !== true,
  },
});
