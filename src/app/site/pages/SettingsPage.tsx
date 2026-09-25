import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Eraser, HardDrive, LayoutDashboard, RefreshCw, Trash2, Upload } from "lucide-react";
import { getSiteApps } from "@/core/site-registry";
import { estimateStorage } from "@/core/storage/db";
import { exportTables, importBackup } from "@/core/storage/backup";
import { NEWTAB_TABLES } from "@/core/storage/scopes";
import { formatBytes, isNetworkCacheKey, localStorageBytes, measureTables } from "@/core/storage/usage";
import {
  clearAutoWallpapers,
  clearNetworkCache,
  clearNotificationLog,
  clearTables,
  dropWallpaperOriginals,
} from "@/core/storage/maintenance";
import { Button } from "@/shared/ui";

interface Usage {
  newtab: number;
  newtabLocal: number;
  apps: Record<string, number>;
  total: number;
  quota: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export function SettingsPage() {
  const { t } = useTranslation();
  const dataApps = useMemo(() => getSiteApps().filter((a) => a.dataTables?.length), []);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    const [newtabTables, est, ...appSizes] = await Promise.all([
      measureTables(NEWTAB_TABLES),
      estimateStorage(),
      ...dataApps.map((a) => measureTables(a.dataTables!)),
    ]);
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    setUsage({
      newtab: sum(newtabTables),
      newtabLocal: localStorageBytes(),
      apps: Object.fromEntries(dataApps.map((a, i) => [a.id, sum(appSizes[i])])),
      total: est?.usage ?? 0,
      quota: est?.quota ?? 0,
    });
    setScanning(false);
  }, [dataApps]);

  useEffect(() => {
    void scan();
  }, [scan]);

  /** Run an action with a busy flag + a result line, then rescan. */
  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key);
    setMsg(null);
    try {
      const text = await action();
      if (text) setMsg({ text });
    } catch {
      setMsg({ text: t("site.settings.actionFailed"), error: true });
    } finally {
      setBusy(null);
      void scan();
    }
  };

  const allTables = [...NEWTAB_TABLES, ...dataApps.flatMap((a) => a.dataTables!)];
  const newtabTotal = usage ? usage.newtab + usage.newtabLocal : 0;
  const appsTotal = usage ? Object.values(usage.apps).reduce((a, b) => a + b, 0) : 0;
  const measured = newtabTotal + appsTotal;
  const other = usage ? Math.max(0, usage.total - measured) : 0;
  const barMax = Math.max(1, measured + other);
  const pct = (n: number) => `${(n / barMax) * 100}%`;
  const maxApp = Math.max(1, ...Object.values(usage?.apps ?? {}));

  const onImport = async (file: File) => {
    if (!window.confirm(t("site.settings.importConfirm"))) return;
    await run("import", async () => {
      const res = await importBackup(file);
      if (!res.ok) {
        setMsg({
          text: t(res.error === "newer-version" ? "settings.importNewer" : "settings.importInvalid"),
          error: true,
        });
        return;
      }
      window.setTimeout(() => window.location.reload(), 900);
      return t("site.settings.importDone", { count: res.tables?.length ?? 0 });
    });
  };

  const confirmThen = (question: string, key: string, action: () => Promise<number> | number) =>
    run(key, async () => {
      if (!window.confirm(question)) return;
      const n = await action();
      return t("site.settings.removed", { count: n });
    });

  const cleanups = [
    { key: "originals", label: "site.settings.cleanOriginals", desc: "site.settings.cleanOriginalsDesc", action: dropWallpaperOriginals },
    { key: "auto-wp", label: "site.settings.cleanAutoWp", desc: "site.settings.cleanAutoWpDesc", action: clearAutoWallpapers },
    { key: "notif", label: "site.settings.cleanNotifications", desc: "site.settings.cleanNotificationsDesc", action: clearNotificationLog },
    { key: "cache", label: "site.settings.cleanCache", desc: "site.settings.cleanCacheDesc", action: async () => clearNetworkCache() },
  ];

  return (
    <div className="sset">
      <div className="home__hero">
        <h1 className="home__title">{t("site.settings.title")}</h1>
        <p className="home__sub">{t("site.settings.sub")}</p>
      </div>

      {msg && (
        <div className={`sset__msg ${msg.error ? "sset__msg--error" : ""}`} role="status">
          {msg.text}
        </div>
      )}

      {/* ---------- storage overview ---------- */}
      <section className="sset__card">
        <div className="sset__card-head">
          <h2 className="sset__card-title">
            <HardDrive size={16} /> {t("site.settings.storage")}
          </h2>
          <Button size="sm" variant="ghost" disabled={scanning} onClick={() => void scan()}>
            <RefreshCw size={14} className={scanning ? "sset__spin" : ""} /> {t("site.settings.rescan")}
          </Button>
        </div>

        <div className="sset__bar" aria-hidden>
          <span className="sset__bar-seg sset__bar-seg--newtab" style={{ width: pct(newtabTotal) }} />
          <span className="sset__bar-seg sset__bar-seg--apps" style={{ width: pct(appsTotal) }} />
          <span className="sset__bar-seg sset__bar-seg--other" style={{ width: pct(other) }} />
        </div>

        <div className="sset__legend">
          <Legend kind="newtab" label={t("site.settings.newtab")} value={usage ? formatBytes(newtabTotal) : "…"} />
          <Legend kind="apps" label={t("site.settings.apps")} value={usage ? formatBytes(appsTotal) : "…"} />
          <Legend kind="other" label={t("site.settings.other")} value={usage ? formatBytes(other) : "…"} />
        </div>

        <p className="sset__note">
          {usage && usage.quota > 0 &&
            t("site.settings.totalOf", { used: formatBytes(usage.total), quota: formatBytes(usage.quota) })}{" "}
          {t("site.settings.estimateNote")}
        </p>
      </section>

      {/* ---------- backup ---------- */}
      <section className="sset__card">
        <div className="sset__card-head">
          <h2 className="sset__card-title">
            <Download size={16} /> {t("site.settings.backup")}
          </h2>
        </div>
        <p className="sset__note">{t("site.settings.backupDesc")}</p>
        <div className="sset__row-actions">
          <Button
            variant="primary"
            disabled={!!busy}
            onClick={() => void run("export-all", () => exportTables(allTables, "all", `konnn-backup-all-${today()}.zip`))}
          >
            <Download size={15} /> {t("site.settings.exportAll")}
          </Button>
          <Button disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> {t("site.settings.import")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onImport(f);
            }}
          />
        </div>
      </section>

      {/* ---------- New Tab ---------- */}
      <section className="sset__card">
        <div className="sset__card-head">
          <h2 className="sset__card-title">
            <span className="sset__dot sset__dot--newtab" />
            <LayoutDashboard size={16} /> {t("site.settings.newtab")}
            <span className="sset__size">{usage ? formatBytes(newtabTotal) : "…"}</span>
          </h2>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() => void run("export-newtab", () => exportTables(NEWTAB_TABLES, "newtab", `newtab-backup-${today()}.zip`))}
          >
            <Download size={14} /> {t("site.settings.export")}
          </Button>
        </div>
        {usage && (
          <p className="sset__note">
            {t("site.settings.newtabBreakdown", {
              db: formatBytes(usage.newtab),
              local: formatBytes(usage.newtabLocal),
              cache: formatBytes(localStorageBytes(isNetworkCacheKey)),
            })}
          </p>
        )}
        <div className="sset__cleanups">
          {cleanups.map((c) => (
            <div key={c.key} className="sset__cleanup">
              <div>
                <div className="sset__cleanup-label">{t(c.label)}</div>
                <div className="sset__note">{t(c.desc)}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={!!busy}
                onClick={() => void confirmThen(t("site.settings.confirmClean", { what: t(c.label) }), c.key, c.action)}
              >
                <Eraser size={14} /> {t("site.settings.clean")}
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Apps & Tools ---------- */}
      <section className="sset__card">
        <div className="sset__card-head">
          <h2 className="sset__card-title">
            <span className="sset__dot sset__dot--apps" />
            {t("site.settings.apps")}
            <span className="sset__size">{usage ? formatBytes(appsTotal) : "…"}</span>
          </h2>
        </div>
        <div className="sset__apps">
          {dataApps.map((app) => {
            const size = usage?.apps[app.id] ?? 0;
            return (
              <div key={app.id} className="sset__app">
                <span className="sset__app-icon">
                  <app.icon size={16} />
                </span>
                <div className="sset__app-main">
                  <div className="sset__app-top">
                    <a className="sset__app-name" href={`#${app.path}`}>
                      {t(app.nameKey)}
                    </a>
                    <span className="sset__size">{usage ? formatBytes(size) : "…"}</span>
                  </div>
                  <div className="sset__app-bar">
                    <span style={{ width: `${(size / maxApp) * 100}%` }} />
                  </div>
                </div>
                <div className="sset__app-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t("site.settings.export")}
                    disabled={!!busy || size === 0}
                    onClick={() =>
                      void run(`export-${app.id}`, () =>
                        exportTables(app.dataTables!, `app:${app.id}`, `${app.id}-backup-${today()}.zip`),
                      )
                    }
                  >
                    <Download size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t("site.settings.clearApp")}
                    disabled={!!busy || size === 0}
                    onClick={() =>
                      void confirmThen(
                        t("site.settings.confirmClearApp", { app: t(app.nameKey) }),
                        `clear-${app.id}`,
                        () => clearTables(app.dataTables!),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Legend({ kind, label, value }: { kind: "newtab" | "apps" | "other"; label: string; value: string }) {
  return (
    <span className="sset__legend-item">
      <span className={`sset__dot sset__dot--${kind}`} />
      {label}
      <b>{value}</b>
    </span>
  );
}
