import { defineSchema } from "@/core/settings-engine/schema";

export const newsSettingsSchema = defineSchema({
  bubble: {
    type: "toggle",
    label: "news.bubble",
    description: "news.bubbleDesc",
    default: true,
  },
});
