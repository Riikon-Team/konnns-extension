import pkg from "../../../../package.json";

/**
 * Data for the Contribute panel. Everything comes from the GitHub repo —
 * releases, contributors, commits — and is cached through core/net `swr`
 * (localStorage "newtab.cache.*"), so the panel shows the last known list
 * offline or when the unauthenticated API limit (60 req/h) is hit.
 */

export interface Contributor {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
}

export interface CommitItem {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  author?: {
    login: string;
    avatar_url: string;
    html_url: string;
  };
  html_url: string;
}

export interface ReleaseItem {
  version: string;
  /** release title when it says more than the tag ("Beta (dev) · v0.3.2-beta") */
  title?: string;
  date: string;
  url: string;
  isLatest: boolean;
  prerelease: boolean;
  /** markdown release notes */
  body: string;
}

export const GITHUB_REPO_URL = pkg.homepage ?? "https://github.com/konnn04/konnns-extension";
export const GITHUB_ISSUES_URL =
  (typeof pkg.bugs === "object" && pkg.bugs?.url ? pkg.bugs.url : null) ?? `${GITHUB_REPO_URL}/issues`;
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
const REPO_PATH = GITHUB_REPO_URL.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
const API = `https://api.github.com/repos/${REPO_PATH}`;

/** re-fetch at most this often; a stale cache still shows meanwhile */
export const CONTRIBUTE_CACHE_TTL = 60 * 60 * 1000;
/** cache key — bump when the cached shape changes */
export const CONTRIBUTE_CACHE_KEY = REPO_PATH + "@2";

export const isBot = (name?: string, type?: string) => {
  const n = (name || "").toLowerCase();
  const t = (type || "").toLowerCase();
  return (
    t === "bot" ||
    n.includes("[bot]") ||
    n.includes("github-actions") ||
    n.includes("dependabot") ||
    n.endsWith("-bot")
  );
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchContributors(): Promise<Contributor[]> {
  const data = await getJson<(Contributor & { type?: string })[]>(`${API}/contributors`);
  const humans = data.filter((c) => !isBot(c.login, c.type));
  return humans.length > 0 ? humans : data;
}

export async function fetchCommits(): Promise<CommitItem[]> {
  const data = await getJson<CommitItem[]>(`${API}/commits?per_page=8`);
  const humans = data.filter((c) => !isBot(c.author?.login || c.commit?.author?.name));
  return humans.length > 0 ? humans : data;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  created_at: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
}

export async function fetchReleases(): Promise<ReleaseItem[]> {
  const data = await getJson<GitHubRelease[]>(`${API}/releases?per_page=20`);
  const published = data.filter((r) => !r.draft);
  // "latest" = newest stable release; a rolling beta doesn't get the badge
  const latestTag = published.find((r) => !r.prerelease)?.tag_name;
  return published.map((r) => {
    const name = r.name?.trim();
    return {
      version: r.tag_name,
      title: name && name !== r.tag_name ? name : undefined,
      date: (r.published_at ?? r.created_at).split("T")[0],
      url: r.html_url,
      isLatest: r.tag_name === latestTag,
      prerelease: r.prerelease,
      body: r.body?.trim() ?? "",
    };
  });
}
