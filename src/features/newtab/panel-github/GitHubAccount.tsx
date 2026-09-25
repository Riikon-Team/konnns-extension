import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, User, XCircle } from "lucide-react";
import { useFeatureValues, useSettingsStore } from "@/core/settings-engine/settingsStore";
import { Button, Field, Segmented, TextInput } from "@/shared/ui";
import {
  fetchProfile,
  fetchPublicProfile,
  hasContributionsAccess,
  requestContributionsAccess,
} from "./api";
import { GITHUB_FEATURE_ID, githubConnection, type GitHubMode } from "./connection";

/** Token page with the scopes this panel uses already ticked. */
const NEW_TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=read:user,notifications&description=My%20NewTab";

type Check = { state: "idle" | "busy" } | { state: "ok"; login: string; avatar: string } | { state: "error"; key: string };

/**
 * Connection block shown at the top of the GitHub settings: pick "username"
 * (public, no sign-in) or "personal token" (everything), fill one field, test it.
 */
export function GitHubAccount() {
  const { t } = useTranslation();
  const values = useFeatureValues(GITHUB_FEATURE_ID);
  const setValue = useSettingsStore((s) => s.setValue);
  const conn = githubConnection(values);

  // local drafts → saved on blur / Enter (the panel refetches on every save)
  const [username, setUsername] = useState(conn.username);
  const [token, setToken] = useState(conn.token);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [calendarAccess, setCalendarAccess] = useState<boolean | null>(null);

  useEffect(() => {
    void hasContributionsAccess().then(setCalendarAccess);
  }, []);

  const setMode = (m: string) => {
    setValue(GITHUB_FEATURE_ID, "authMode", m as GitHubMode);
    setCheck({ state: "idle" });
  };
  const commitUsername = () => setValue(GITHUB_FEATURE_ID, "username", username.trim().replace(/^@/, ""));
  const commitToken = () => setValue(GITHUB_FEATURE_ID, "token", token.trim());

  const test = async () => {
    if (conn.mode === "username") commitUsername();
    else commitToken();
    setCheck({ state: "busy" });
    try {
      const p =
        conn.mode === "username"
          ? await fetchPublicProfile(username.trim().replace(/^@/, ""))
          : await fetchProfile(token.trim());
      setCheck({ state: "ok", login: p.login, avatar: p.avatarUrl });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setCheck({
        state: "error",
        key:
          msg === "github-user-not-found"
            ? "github.errUserNotFound"
            : msg === "github-rate-limited"
              ? "github.errRateLimited"
              : conn.mode === "token"
                ? "github.errBadToken"
                : "github.error",
      });
    }
  };

  const canTest = conn.mode === "username" ? !!username.trim() : !!token.trim();

  return (
    <div className="gh-account">
      <Field label={t("github.connectVia")}>
        <Segmented
          value={conn.mode}
          onChange={setMode}
          options={[
            { value: "username", label: t("github.modeUsername") },
            { value: "token", label: t("github.modeToken") },
          ]}
        />
      </Field>

      {conn.mode === "username" ? (
        <Field label={t("github.username")} description={t("github.usernameDesc")}>
          <div className="gh-account__input">
            <User size={15} aria-hidden />
            <TextInput
              placeholder="octocat"
              autoComplete="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={commitUsername}
              onKeyDown={(e) => e.key === "Enter" && void test()}
            />
          </div>
        </Field>
      ) : (
        <Field label={t("github.token")} description={t("github.tokenDescShort")}>
          <div className="gh-account__input">
            <KeyRound size={15} aria-hidden />
            <TextInput
              type="password"
              placeholder="ghp_…"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onBlur={commitToken}
              onKeyDown={(e) => e.key === "Enter" && void test()}
            />
          </div>
          <a className="gh-account__link" href={NEW_TOKEN_URL} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={12} /> {t("github.createToken")}
          </a>
        </Field>
      )}

      <div className="gh-account__row">
        <Button size="sm" variant="primary" disabled={!canTest || check.state === "busy"} onClick={() => void test()}>
          {check.state === "busy" && <Loader2 size={14} className="gh-account__spin" />}
          {t("github.testConnection")}
        </Button>
        {check.state === "ok" && (
          <span className="gh-account__ok">
            <img src={check.avatar} alt="" />
            <CheckCircle2 size={14} /> @{check.login}
          </span>
        )}
        {check.state === "error" && (
          <span className="gh-account__err">
            <XCircle size={14} /> {t(check.key)}
          </span>
        )}
      </div>

      {conn.mode === "username" && calendarAccess === false && (
        <div className="gh-account__note">
          <span>{t("github.calendarNeedsAccess")}</span>
          <Button
            size="sm"
            // gesture-safe: the permission request is the first thing in the click
            onClick={() => void requestContributionsAccess().then(setCalendarAccess)}
          >
            {t("github.allowCalendar")}
          </Button>
        </div>
      )}
      {conn.mode === "username" && <p className="ui-field__desc">{t("github.usernameLimits")}</p>}
    </div>
  );
}
