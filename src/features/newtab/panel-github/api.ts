/**
 * GitHub, two ways to connect:
 *  - Personal Access Token (docs/phase-3 §2): everything, via GraphQL — the
 *    token never leaves the browser except to api.github.com.
 *  - Just a username: public data only, no sign-in. Profile + repos come from
 *    the unauthenticated REST API (60 req/h per IP — cached 1h, 2 calls per
 *    refresh). The contribution calendar has NO public API, so it is read from
 *    github.com's own calendar page, which needs host access to github.com
 *    (optional permission, asked on a click). Notifications need a token.
 */

import { hasPermissions, requestPermissions } from "@/core/permissions";

export interface ContribDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface RecentRepo {
  name: string;
  description: string | null;
  url: string;
  stars: number;
  language: string | null;
  pushedAt: number;
}

export interface GitHubProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  followers: number;
  following: number;
  repos: number;
  totalContributions: number;
  weeks: ContribDay[][];
  recentRepos: RecentRepo[];
}

const GQL = `query {
  viewer {
    login name avatarUrl bio
    followers { totalCount }
    following { totalCount }
    repositories { totalCount }
    recentRepos: repositories(first: 20, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes { name description url stargazerCount pushedAt primaryLanguage { name } }
    }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

function levelFor(count: number): ContribDay["level"] {
  if (count === 0) return 0;
  if (count < 3) return 1;
  if (count < 6) return 2;
  if (count < 10) return 3;
  return 4;
}

export async function fetchProfile(token: string): Promise<GitHubProfile> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: GQL }),
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error("github graphql error");
  const v = json.data.viewer;
  const cal = v.contributionsCollection.contributionCalendar;

  return {
    login: v.login,
    name: v.name,
    avatarUrl: v.avatarUrl,
    bio: v.bio,
    followers: v.followers.totalCount,
    following: v.following.totalCount,
    repos: v.repositories.totalCount,
    totalContributions: cal.totalContributions,
    weeks: cal.weeks.map((w: { contributionDays: { date: string; contributionCount: number }[] }) =>
      w.contributionDays.map((d) => ({
        date: d.date,
        count: d.contributionCount,
        level: levelFor(d.contributionCount),
      })),
    ),
    recentRepos: (v.recentRepos?.nodes ?? []).map(
      (r: {
        name: string;
        description: string | null;
        url: string;
        stargazerCount: number;
        pushedAt: string;
        primaryLanguage: { name: string } | null;
      }): RecentRepo => ({
        name: r.name,
        description: r.description,
        url: r.url,
        stars: r.stargazerCount,
        language: r.primaryLanguage?.name ?? null,
        pushedAt: new Date(r.pushedAt).getTime(),
      }),
    ),
  };
}

/* ------------------------------------------------ username (public) mode */

export const GITHUB_WEB_ORIGIN = "https://github.com/*";

export function hasContributionsAccess(): Promise<boolean> {
  return hasPermissions({ origins: [GITHUB_WEB_ORIGIN] });
}

/** Must be called straight from a click (user gesture). */
export function requestContributionsAccess(): Promise<boolean> {
  return requestPermissions({ origins: [GITHUB_WEB_ORIGIN] });
}

/**
 * Contribution calendar from github.com/users/<u>/contributions (the fragment
 * the profile page itself loads). Days are `<td data-date data-level id>`;
 * counts sit in `<tool-tip for=id>` ("5 contributions on …" / "No contributions …").
 */
export async function fetchPublicContributions(
  username: string,
): Promise<{ weeks: ContribDay[][]; total: number }> {
  const res = await fetch(`https://github.com/users/${encodeURIComponent(username)}/contributions`, {
    credentials: "omit",
  });
  if (!res.ok) throw new Error(`github-web ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");

  const days: ContribDay[] = [];
  doc.querySelectorAll<HTMLElement>("td[data-date]").forEach((td) => {
    const date = td.dataset.date!;
    const tip = td.id ? doc.querySelector(`tool-tip[for="${td.id}"]`)?.textContent ?? "" : "";
    const m = tip.match(/([\d,.]+)\s+contribution/i);
    const count = m ? Number(m[1].replace(/[,.]/g, "")) : 0;
    const lvl = Number(td.dataset.level ?? NaN);
    days.push({ date, count, level: (lvl >= 0 && lvl <= 4 ? lvl : levelFor(count)) as ContribDay["level"] });
  });
  if (days.length === 0) throw new Error("github-web no calendar");

  // columns = weeks starting on Sunday, like the GraphQL calendar
  days.sort((a, b) => a.date.localeCompare(b.date));
  const weeks: ContribDay[][] = [];
  for (const d of days) {
    if (weeks.length === 0 || new Date(`${d.date}T00:00:00Z`).getUTCDay() === 0) weeks.push([]);
    weeks[weeks.length - 1].push(d);
  }
  return { weeks, total: days.reduce((s, d) => s + d.count, 0) };
}

/** Public profile + recent repos (+ calendar when github.com access is granted). */
export async function fetchPublicProfile(username: string): Promise<GitHubProfile> {
  const u = encodeURIComponent(username);
  const headers = { Accept: "application/vnd.github+json" };
  const [userRes, reposRes] = await Promise.all([
    fetch(`https://api.github.com/users/${u}`, { headers }),
    fetch(`https://api.github.com/users/${u}/repos?sort=pushed&per_page=20`, { headers }),
  ]);
  if (userRes.status === 404) throw new Error("github-user-not-found");
  if (userRes.status === 403) throw new Error("github-rate-limited");
  if (!userRes.ok) throw new Error(`github ${userRes.status}`);
  const user = await userRes.json();
  const repos: unknown[] = reposRes.ok ? await reposRes.json() : [];

  let calendar: { weeks: ContribDay[][]; total: number } = { weeks: [], total: -1 };
  if (await hasContributionsAccess()) {
    calendar = await fetchPublicContributions(username).catch(() => calendar);
  }

  return {
    login: user.login,
    name: user.name ?? null,
    avatarUrl: user.avatar_url,
    bio: user.bio ?? null,
    followers: user.followers ?? 0,
    following: user.following ?? 0,
    repos: user.public_repos ?? 0,
    totalContributions: calendar.total,
    weeks: calendar.weeks,
    recentRepos: (Array.isArray(repos) ? repos : []).map((r) => {
      const repo = r as {
        name: string;
        description: string | null;
        html_url: string;
        stargazers_count: number;
        language: string | null;
        pushed_at: string;
      };
      return {
        name: repo.name,
        description: repo.description,
        url: repo.html_url,
        stars: repo.stargazers_count,
        language: repo.language,
        pushedAt: new Date(repo.pushed_at).getTime(),
      };
    }),
  };
}

export interface GitHubNotification {
  id: string;
  title: string;
  repo: string;
  reason: string;
  url: string;
}

export type TrendingWindow = "day" | "week" | "month";

export interface TrendingRepo {
  name: string;
  url: string;
  stars: number;
  language: string | null;
  description: string | null;
}

/** Approximate "trending" via the search API: repos created in the window,
 * sorted by stars. Optional feature (docs item 10). */
export async function fetchTrending(
  token: string,
  window: TrendingWindow,
): Promise<TrendingRepo[]> {
  const days = window === "day" ? 1 : window === "week" ? 7 : 30;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const q = encodeURIComponent(`created:>=${since}`);
  // search works unauthenticated too (lower rate limit) — username mode uses it
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `bearer ${token}`;
  const res = await fetch(
    `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=6`,
    { headers },
  );
  if (!res.ok) return [];
  const json = await res.json();
  return (json.items ?? []).map(
    (r: {
      full_name: string;
      html_url: string;
      stargazers_count: number;
      language: string | null;
      description: string | null;
    }): TrendingRepo => ({
      name: r.full_name,
      url: r.html_url,
      stars: r.stargazers_count,
      language: r.language,
      description: r.description,
    }),
  );
}

/** Recent notifications with detail (needs the `notifications` scope). */
export async function fetchNotifications(token: string): Promise<GitHubNotification[]> {
  const res = await fetch("https://api.github.com/notifications?per_page=8", {
    headers: { Authorization: `bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return [];
  const list = await res.json();
  if (!Array.isArray(list)) return [];
  return list.map(
    (n: {
      id: string;
      reason: string;
      subject: { title: string };
      repository: { full_name: string; html_url: string };
    }): GitHubNotification => ({
      id: n.id,
      title: n.subject.title,
      repo: n.repository.full_name,
      reason: n.reason,
      url: n.repository.html_url,
    }),
  );
}

/** Count of unread GitHub notifications (needs the `notifications` scope). */
export async function fetchUnreadCount(token: string): Promise<number> {
  const res = await fetch("https://api.github.com/notifications?per_page=50", {
    headers: { Authorization: `bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return 0;
  const list = await res.json();
  return Array.isArray(list) ? list.length : 0;
}

export interface LanguageStat {
  name: string;
  count: number;
  pct: number;
}

/** Approximate language breakdown from primary languages of recently-pushed
 * repos (no per-repo byte-level breakdown to avoid N extra API calls). */
export function computeLanguageStats(
  repos: RecentRepo[],
  excluded: string[],
): LanguageStat[] {
  const excludedLower = new Set(excluded.map((l) => l.trim().toLowerCase()).filter(Boolean));
  const counts = new Map<string, number>();
  for (const r of repos) {
    if (!r.language) continue;
    if (excludedLower.has(r.language.toLowerCase())) continue;
    counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, pct: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count);
}
