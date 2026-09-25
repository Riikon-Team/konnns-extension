import type { ComponentType, LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Site App Registry — docs/site/00-tong-quan.md §2.
 * Same idea as core/feature-registry, but for the Custom Site surface: adding a
 * mini-app = create a folder + one import line. The site home grid, the shell's
 * left nav and the popup's app list are ALL generated from here, so nothing
 * hardcodes the app list.
 */

export type SiteAppCategory = "media" | "text" | "dev" | "other";

/** Display order of categories — shared by the home grid and the side nav. */
export const SITE_CATEGORY_ORDER: SiteAppCategory[] = ["media", "text", "dev", "other"];

/** Visible apps grouped by category, in SITE_CATEGORY_ORDER; empty groups dropped. */
export function groupSiteApps<T extends { category?: SiteAppCategory }>(apps: T[]): Array<[SiteAppCategory, T[]]> {
  const by = new Map<SiteAppCategory, T[]>();
  for (const app of apps) {
    const key = app.category ?? "other";
    by.set(key, [...(by.get(key) ?? []), app]);
  }
  return SITE_CATEGORY_ORDER.filter((c) => by.has(c)).map((c) => [c, by.get(c)!]);
}

export interface SiteAppDefinition {
  id: string;
  /** hash route, always leading-slash: "/audio" → site.html#/audio */
  path: string;
  /** i18n key for the display name */
  nameKey: string;
  /** i18n key for the one-line description on the home card */
  descKey: string;
  icon: LucideIcon;
  /** lazy so a heavy app (wavesurfer, wasm…) never lands in the home bundle */
  component: ComponentType | LazyExoticComponent<ComponentType>;
  category?: SiteAppCategory;
  /** app paints its own full-height layout; the shell drops its padding */
  fullBleed?: boolean;
  /** reachable by route but not listed on the home grid / nav (e.g. viewers) */
  hidden?: boolean;
  /**
   * IndexedDB tables this app owns. The site Settings page uses it to show
   * the app's storage, back it up on its own and clear it — declare every
   * table the app writes, or its data is invisible there.
   */
  dataTables?: string[];
  order?: number;
}

const registry = new Map<string, SiteAppDefinition>();

export function registerSiteApp(def: SiteAppDefinition): void {
  registry.set(def.id, def);
}

export function getSiteApps(): SiteAppDefinition[] {
  return [...registry.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Apps shown in the home grid and the nav (excludes `hidden`). */
export function getVisibleSiteApps(): SiteAppDefinition[] {
  return getSiteApps().filter((a) => !a.hidden);
}

export function getSiteApp(id: string): SiteAppDefinition | undefined {
  return registry.get(id);
}

/**
 * Resolve a route to an app. Matches the exact path or a sub-path, so
 * "/clip/abc123" resolves to the app registered at "/clip".
 */
export function matchSiteApp(pathname: string): SiteAppDefinition | undefined {
  const apps = getSiteApps();
  return (
    apps.find((a) => a.path === pathname) ??
    apps.find((a) => a.path !== "/" && pathname.startsWith(`${a.path}/`))
  );
}
