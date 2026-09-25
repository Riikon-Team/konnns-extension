import { defineSchema } from "@/core/settings-engine/schema";

// the connection (username / personal token) is the GitHubAccount block above
// this form — see settingsExtra in index.tsx
export const githubSettingsSchema = defineSchema({
  showTrending: {
    type: "toggle",
    label: "github.showTrending",
    description: "github.showTrendingDesc",
    default: false,
  },
  showRecentRepos: {
    type: "toggle",
    label: "github.showRecentRepos",
    default: true,
  },
  showLanguageStats: {
    type: "toggle",
    label: "github.showLanguageStats",
    description: "github.showLanguageStatsDesc",
    default: false,
  },
  excludedLanguages: {
    type: "text",
    label: "github.excludedLanguages",
    description: "github.excludedLanguagesDesc",
    placeholder: "github.excludedLanguagesPlaceholder",
    showIf: (v) => v.showLanguageStats === true,
  },
});
