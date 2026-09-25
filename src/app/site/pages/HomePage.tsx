import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { getVisibleSiteApps, groupSiteApps } from "@/core/site-registry";

export function HomePage() {
  const { t } = useTranslation();
  const all = useMemo(() => getVisibleSiteApps(), []);
  const [query, setQuery] = useState("");

  const apps = useMemo(() => {
    const needle = fold(query);
    if (!needle) return all;
    return all.filter((app) =>
      `${fold(t(app.nameKey))} ${fold(t(app.descKey))}`.includes(needle),
    );
  }, [all, query, t]);

  const groups = useMemo(() => groupSiteApps(apps), [apps]);

  return (
    <div className="home">
      <div className="home__hero">
        <h1 className="home__title">{t("site.home.heading")}</h1>
        <p className="home__sub">{t("site.home.sub")}</p>
      </div>

      {all.length > 0 && (
        <div className="home__search">
          <Search size={15} />
          <input
            type="search"
            value={query}
            placeholder={t("site.home.searchPlaceholder")}
            aria-label={t("site.home.search")}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" aria-label={t("common.cancel")} onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {apps.length === 0 && (
        <p className="home__empty">
          {query ? t("site.home.noMatch", { query }) : t("site.home.empty")}
        </p>
      )}

      {groups.map(([category, list]) => (
        <section key={category} className="home__group">
          <h2 className="home__group-title">{t(`site.categories.${category}`)}</h2>
          <div className="home__grid">
            {list.map((app) => (
              <a key={app.id} className="home__card" href={`#${app.path}`}>
                <span className="home__card-icon">
                  <app.icon size={22} />
                </span>
                <span className="home__card-name">{t(app.nameKey)}</span>
                <span className="home__card-desc">{t(app.descKey)}</span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .trim();
}
