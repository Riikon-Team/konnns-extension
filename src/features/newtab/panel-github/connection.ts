export const GITHUB_FEATURE_ID = "panel-github";

export type GitHubMode = "username" | "token";

export interface GitHubConnection {
  mode: GitHubMode;
  token: string;
  username: string;
  /** enough filled in to load anything */
  ready: boolean;
}

/**
 * Which way the panel talks to GitHub. `authMode` is only stored once the user
 * picks one; before that a saved token means "token" — so everyone who set a
 * token before the username option existed keeps working unchanged.
 */
export function githubConnection(values: Record<string, unknown>): GitHubConnection {
  const token = typeof values.token === "string" ? values.token.trim() : "";
  const username = typeof values.username === "string" ? values.username.trim().replace(/^@/, "") : "";
  const mode: GitHubMode =
    values.authMode === "token" || values.authMode === "username"
      ? values.authMode
      : token
        ? "token"
        : "username";
  return { mode, token, username, ready: mode === "token" ? !!token : !!username };
}
