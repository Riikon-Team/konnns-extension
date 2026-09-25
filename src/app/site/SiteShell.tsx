import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { House, Info, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Settings } from "lucide-react";
import { groupSiteApps, matchSiteApp, getVisibleSiteApps } from "@/core/site-registry";
import { useHashRoute } from "@/core/router/useHashRoute";
import { ensurePersistentStorage } from "@/core/storage/persistence";
import { Modal, Skeleton } from "@/shared/ui";
import { HomePage } from "./pages/HomePage";
import { QuickSettings } from "./QuickSettings";
import { NotFound } from "./pages/NotFound";
import { ContributePanel } from "../newtab/settings/ContributePanel";

const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

const SETTINGS_PATH = "/settings";

export function SiteShell() {
  const { t } = useTranslation();
  const route = useHashRoute();
  const apps = useMemo(() => getVisibleSiteApps(), []);
  const groups = useMemo(() => groupSiteApps(apps), [apps]);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    void ensurePersistentStorage();
  }, []);

  const isHome = route.path === "/";
  const isSettings = route.path === SETTINGS_PATH;
  const active = isHome || isSettings ? undefined : matchSiteApp(route.path);
  const Content = active?.component;
  const isZen = route.query.zen === "1";

  const autoCollapsed = !isHome && !isSettings;
  const [railPath, setRailPath] = useState(route.path);
  const [railCollapsed, setRailCollapsed] = useState(autoCollapsed);
  if (railPath !== route.path) {
    setRailPath(route.path);
    setRailCollapsed(autoCollapsed);
  }
  const toggleRail = () => setRailCollapsed((v) => !v);

  const crumb = active ? t(active.nameKey) : isSettings ? t("site.settings.title") : null;

  return (
    <div className={`site ${isZen ? "site--zen" : ""}`}>
      {!isZen && (
        <header className="site__topbar">
          <button
            type="button"
            className="site__rail-toggle"
            aria-expanded={!railCollapsed}
            title={t(railCollapsed ? "site.expandRail" : "site.collapseRail")}
            onClick={toggleRail}
          >
            {railCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <a className="site__brand" href="#/">
            <PanelsTopLeft size={18} />
            <span>{t("site.title")}</span>
          </a>
          {crumb && <span className="site__crumb">{crumb}</span>}
          <span className="site__topbar-spacer" />
          <QuickSettings />
        </header>
      )}

      <div className={`site__body ${isZen ? "site__body--zen" : railCollapsed ? "site__body--rail-collapsed" : ""}`}>
        {!isZen && (
          <nav className="site__rail" aria-label={t("site.title")}>
            <a
              className={`site__rail-item ${isHome ? "site__rail-item--active" : ""}`}
              href="#/"
              title={t("site.nav.home")}
            >
              <House size={18} />
              <span className="site__rail-label">{t("site.nav.home")}</span>
            </a>

            {groups.map(([category, list]) => (
              <div key={category} className="site__rail-group" role="group" aria-label={t(`site.categories.${category}`)}>
                <span className="site__rail-group-title">{t(`site.categories.${category}`)}</span>
                {list.map((app) => (
                  <a
                    key={app.id}
                    className={`site__rail-item ${active?.id === app.id ? "site__rail-item--active" : ""}`}
                    href={`#${app.path}`}
                    title={t(app.nameKey)}
                  >
                    <app.icon size={18} />
                    <span className="site__rail-label">{t(app.nameKey)}</span>
                  </a>
                ))}
              </div>
            ))}

            <div className="site__rail-footer">
              <a
                className={`site__rail-item ${isSettings ? "site__rail-item--active" : ""}`}
                href={`#${SETTINGS_PATH}`}
                title={t("site.settings.title")}
              >
                <Settings size={18} />
                <span className="site__rail-label">{t("site.settings.title")}</span>
              </a>
              <button
                type="button"
                className="site__rail-item site__rail-item--btn site__rail-item--info"
                title={t("settings.contribute")}
                onClick={() => setShowInfo(true)}
              >
                <Info size={18} />
                <span className="site__rail-label">{t("settings.contribute")}</span>
              </button>
            </div>
          </nav>
        )}

        <main className={`site__main ${active?.fullBleed ? "site__main--bleed" : ""}`}>
          {isHome ? (
            <HomePage />
          ) : isSettings ? (
            <Suspense fallback={<AppSkeleton />}>
              <SettingsPage />
            </Suspense>
          ) : Content ? (
            <Suspense fallback={<AppSkeleton />}>
              <Content />
            </Suspense>
          ) : (
            <NotFound path={route.path} />
          )}
        </main>
      </div>

      <Modal
        open={showInfo}
        onClose={() => setShowInfo(false)}
        title={t("settings.contribute")}
        width="min(92vw, 840px)"
      >
        <div style={{ maxHeight: "78vh", overflowY: "auto", padding: "1rem" }}>
          <ContributePanel />
        </div>
      </Modal>
    </div>
  );
}

function AppSkeleton() {
  return (
    <div className="site__skeleton">
      <Skeleton height={34} width="42%" radius="var(--radius-md)" />
      <Skeleton height={180} radius="var(--radius-lg)" />
      <Skeleton height={120} radius="var(--radius-lg)" />
    </div>
  );
}
