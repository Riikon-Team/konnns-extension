import { useCallback, useEffect, useState } from "react";
import { Bell, BookMarked, Flame, Github, Star, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerFeature } from "@/core/feature-registry";
import { useFeatureValues } from "@/core/settings-engine/settingsStore";
import { useOnlineStatus, swr } from "@/core/net";
import { emit } from "@/core/event-bus";
import { notify } from "@/core/notification-engine";
import { Button, ReloadButton, Segmented, Skeleton } from "@/shared/ui";
import {
  computeLanguageStats,
  fetchNotifications,
  fetchProfile,
  fetchPublicProfile,
  fetchTrending,
  requestContributionsAccess,
  type GitHubNotification,
  type GitHubProfile,
  type LanguageStat,
  type TrendingRepo,
  type TrendingWindow,
} from "./api";
import { githubSettingsSchema } from "./settings.schema";
import { ContribGraph } from "./ContribGraph";
import { GitHubAccount } from "./GitHubAccount";
import { GITHUB_FEATURE_ID, githubConnection } from "./connection";
import "./github.css";

export { GITHUB_FEATURE_ID };

function PanelGitHub() {
  const { t } = useTranslation();
  const values = useFeatureValues(GITHUB_FEATURE_ID);
  const online = useOnlineStatus();
  const conn = githubConnection(values);
  // token only counts in token mode (a leftover token must not leak into username mode)
  const token = conn.mode === "token" ? conn.token : "";
  const username = conn.mode === "username" ? conn.username : "";
  const identity = conn.mode === "token" ? `token` : `user:${username.toLowerCase()}`;
  const showTrending = values.showTrending === true;
  const showRecentRepos = values.showRecentRepos !== false;
  const showLanguageStats = values.showLanguageStats === true;
  const excludedLanguages = ((values.excludedLanguages as string) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [profile, setProfile] = useState<GitHubProfile | null>(null);
  const [notifs, setNotifs] = useState<GitHubNotification[]>([]);
  const [trendWindow, setTrendWindow] = useState<TrendingWindow>("week");
  const [trending, setTrending] = useState<TrendingRepo[]>([]);

  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (showTrending && conn.ready) void fetchTrending(token, trendWindow).then(setTrending);
    else setTrending([]);
  }, [showTrending, conn.ready, token, trendWindow, online]);

  const load = useCallback(
    async (force?: boolean) => {
      if (!conn.ready) {
        setStatus("idle");
        setProfile(null);
        return;
      }
      if (status !== "success") setStatus("loading");

      await swr<GitHubProfile>({
        namespace: "github",
        // per identity, so switching account/mode never shows the previous one
        key: identity === "token" ? "me" : identity,
        ttlMs: 60 * 60 * 1000, // contribution graph caches ~1h (docs/phase-3 §2)
        force,
        fetcher: () => (token ? fetchProfile(token) : fetchPublicProfile(username)),
        onData: (data) => {
          setProfile(data);
          setStatus("success");
        },
        onError: (_e, hadCache) => {
          if (!hadCache && !profile) setStatus("error");
        },
      });

      // notifications need a token — username mode has none
      if (!token) {
        setNotifs([]);
        return;
      }
      // fresher than the profile; raise an in-app/OS notification when count rises
      const list = await fetchNotifications(token);
      setNotifs(list);
      const count = list.length;
      const prev = Number(localStorage.getItem("github.lastUnread") ?? "0");
      if (count > prev) {
        void notify({ source: GITHUB_FEATURE_ID, type: "info", title: "GitHub", body: `${count} ${t("github.unread")}` });
      }
      localStorage.setItem("github.lastUnread", String(count));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identity, token, username, conn.ready],
  );

  useEffect(() => {
    setProfile(null); // don't flash the previous account while the new one loads
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, token, online]);

  const forceReload = async () => {
    setReloading(true);
    await load(true);
    if (showTrending && conn.ready) setTrending(await fetchTrending(token, trendWindow));
    setReloading(false);
  };

  if (!conn.ready) {
    return (
      <div className="news__perm">
        <p className="ui-field__desc">{t("github.notConnected")}</p>
        <Button variant="primary" onClick={() => emit("settings:open", { featureId: GITHUB_FEATURE_ID })}>
          {t("github.openSettings")}
        </Button>
      </div>
    );
  }

  if (status === "loading" || status === "idle") {
    return (
      <div>
        <Skeleton width="70%" height={56} radius="var(--radius-md)" />
        <div style={{ height: 16 }} />
        <Skeleton width="100%" height={72} />
      </div>
    );
  }

  if (status === "error" || !profile) {
    return <p className="ui-field__desc">{t("github.error")}</p>;
  }

  const languageStats: LanguageStat[] = showLanguageStats
    ? computeLanguageStats(profile.recentRepos, excludedLanguages)
    : [];

  return (
    <div className="gh">
      <div className="gh__reload">
        <ReloadButton busy={reloading} label={t("common.retry")} onClick={() => void forceReload()} />
      </div>
      <div className="gh__profile">
        <img className="gh__avatar" src={profile.avatarUrl} alt={profile.login} />
        <div>
          <div className="gh__name">{profile.name ?? profile.login}</div>
          <div className="gh__login">@{profile.login}</div>
          {profile.bio && <div className="gh__bio">{profile.bio}</div>}
        </div>
      </div>

      <div className="gh__lines">
        <span className="gh__line">
          <Users size={14} /> {t("github.followers")}: <b>{profile.followers}</b>
        </span>
        <span className="gh__line">
          <UserPlus size={14} /> {t("github.following")}: <b>{profile.following}</b>
        </span>
        <span className="gh__line">
          <BookMarked size={14} /> {t("github.repos")}: <b>{profile.repos}</b>
        </span>
      </div>

      {profile.weeks.length > 0 ? (
        <>
          <div className="gh__section-title">
            {profile.totalContributions} {t("github.contributions")}
          </div>
          <ContribGraph weeks={profile.weeks} />
        </>
      ) : (
        // username mode without github.com access: offer it right here
        !token && (
          <button
            type="button"
            className="gh__calendar-cta"
            onClick={() =>
              void requestContributionsAccess().then((ok) => {
                if (ok) void load(true);
              })
            }
          >
            {t("github.allowCalendar")}
          </button>
        )
      )}

      {showLanguageStats && languageStats.length > 0 && (
        <>
          <div className="gh__section-title" style={{ marginTop: "var(--space-4)" }}>
            {t("github.showLanguageStats")}
          </div>
          <div className="gh__langs">
            {languageStats.slice(0, 6).map((l) => (
              <div className="gh__lang-row" key={l.name}>
                <span className="gh__lang-name">{l.name}</span>
                <div className="gh__lang-bar">
                  <div className="gh__lang-bar-fill" style={{ width: `${l.pct}%` }} />
                </div>
                <span className="gh__lang-pct">{l.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </>
      )}

      {showRecentRepos && profile.recentRepos?.length > 0 && (
        <>
          <div className="gh__section-title" style={{ marginTop: "var(--space-4)" }}>
            {t("github.recentRepos")}
          </div>
          <div className="gh__list">
            {profile.recentRepos.slice(0, 5).map((r) => (
              <a
                key={r.name}
                className="gh__repo"
                href={r.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                <div className="gh__repo-head">
                  <span className="gh__repo-name">{r.name}</span>
                  {r.stars > 0 && (
                    <span className="gh__repo-stars">
                      <Star size={12} /> {r.stars}
                    </span>
                  )}
                </div>
                {r.description && <div className="gh__repo-desc">{r.description}</div>}
                {r.language && <span className="gh__repo-lang">{r.language}</span>}
              </a>
            ))}
          </div>
        </>
      )}

      {notifs.length > 0 && (
        <>
          <div className="gh__section-title" style={{ marginTop: "var(--space-4)" }}>
            <Bell size={13} style={{ verticalAlign: "-2px" }} /> {notifs.length} {t("github.unread")}
          </div>
          <div className="gh__list">
            {notifs.map((n) => (
              <a
                key={n.id}
                className="gh__notif"
                href={n.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                <div className="gh__notif-title">{n.title}</div>
                <div className="gh__notif-repo">{n.repo}</div>
              </a>
            ))}
          </div>
        </>
      )}

      {showTrending && (
        <>
          <div className="gh__section-title" style={{ marginTop: "var(--space-4)" }}>
            <Flame size={13} style={{ verticalAlign: "-2px" }} /> {t("github.trending")}
          </div>
          <div style={{ marginBottom: "var(--space-2)" }}>
            <Segmented
              value={trendWindow}
              onChange={(v) => setTrendWindow(v as TrendingWindow)}
              options={[
                { value: "day", label: t("github.day") },
                { value: "week", label: t("github.week") },
                { value: "month", label: t("github.month") },
              ]}
            />
          </div>
          <div className="gh__list">
            {trending.map((r) => (
              <a key={r.name} className="gh__repo" href={r.url} target="_blank" rel="noreferrer noopener">
                <div className="gh__repo-head">
                  <span className="gh__repo-name">{r.name}</span>
                  <span className="gh__repo-stars">
                    <Star size={12} /> {r.stars.toLocaleString()}
                  </span>
                </div>
                {r.description && <div className="gh__repo-desc">{r.description}</div>}
                {r.language && <span className="gh__repo-lang">{r.language}</span>}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

registerFeature({
  id: GITHUB_FEATURE_ID,
  zone: "left-sidebar",
  nameKey: "features.panel-github",
  icon: Github,
  defaultEnabled: false,
  requiresNetwork: true,
  notifiable: true,
  settingsSchema: githubSettingsSchema,
  settingsExtra: GitHubAccount,
  settingsExtraPosition: "top", // connect first, then the display options
  component: PanelGitHub,
  order: 3,
});

export default PanelGitHub;
