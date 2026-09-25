import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { exportToBlob, exportToSvg, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Check, Copy, Download } from "lucide-react";
import { Button, Dropdown, Segmented, Toggle } from "@/shared/ui";

/** PNG/SVG export with resolution, theme, and clipboard copy support. */
export function ExportMenu({ api, boardName }: { api: ExcalidrawImperativeAPI | null; boardName: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<number>(1);
  const [transparent, setTransparent] = useState(true);
  const [darkMode, setDarkMode] = useState<boolean>(() => api?.getAppState().theme === "dark");
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  if (!api) return null;

  const elements = api.getSceneElements().filter((el) => !el.isDeleted);
  let dims = { width: 0, height: 0 };
  if (elements.length > 0) {
    const [minX, minY, maxX, maxY] = getCommonBounds(elements);
    dims = {
      width: Math.max(0, Math.round(maxX - minX)),
      height: Math.max(0, Math.round(maxY - minY)),
    };
  }
  const outW = Math.round(dims.width * scale);
  const outH = Math.round(dims.height * scale);

  const getExportAppState = () => {
    const appState = api.getAppState();
    return {
      ...appState,
      exportScale: scale,
      exportBackground: !transparent,
      viewBackgroundColor: transparent ? "transparent" : (appState.viewBackgroundColor || "#ffffff"),
      exportWithDarkMode: darkMode,
    };
  };

  const run = async (format: "png" | "svg") => {
    const currentElements = api.getSceneElements().filter((el) => !el.isDeleted);
    const exportAppState = getExportAppState();
    const files = api.getFiles();
    const baseName = (boardName || t("whiteboard.untitled")).replace(/[<>:"|?*/\\]+/g, "-");

    if (format === "png") {
      const blob = await exportToBlob({
        elements: currentElements,
        appState: exportAppState,
        files,
        mimeType: "image/png",
      });
      download(blob, `${baseName}.png`);
    } else {
      const svg = await exportToSvg({
        elements: currentElements,
        appState: exportAppState,
        files,
      });
      const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
      download(blob, `${baseName}.svg`);
    }
    setOpen(false);
  };

  const copyToClipboard = async () => {
    if (copying) return;
    setCopying(true);
    try {
      const currentElements = api.getSceneElements().filter((el) => !el.isDeleted);
      const exportAppState = getExportAppState();
      const files = api.getFiles();
      const blob = await exportToBlob({
        elements: currentElements,
        appState: exportAppState,
        files,
        mimeType: "image/png",
      });
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob,
        }),
      ]);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1500);
    } catch (err) {
      console.error("Copy whiteboard image to clipboard failed:", err);
    } finally {
      setCopying(false);
    }
  };

  const handleToggleOpen = () => {
    if (!open) {
      // Sync default dark mode state with current board theme on open
      setDarkMode(api.getAppState().theme === "dark");
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <Button ref={anchorRef} variant="primary" onClick={handleToggleOpen}>
        <Download size={15} />
        {t("whiteboard.export")}
      </Button>
      {open && (
        <Dropdown anchor={anchorRef.current} onClose={() => setOpen(false)} matchTriggerWidth={false} width={250}>
          <div className="wb__export-menu">
            <div className="wb__export-row">
              <div className="wb__export-label">
                <span>{t("whiteboard.resolution")}</span>
                {outW > 0 && outH > 0 && <span>{outW} × {outH}</span>}
              </div>
              <Segmented
                value={String(scale)}
                onChange={(v) => setScale(Number(v))}
                options={[
                  { value: "1", label: "1x" },
                  { value: "2", label: "2x" },
                  { value: "3", label: "3x" },
                ]}
              />
            </div>
            <label className="wb__export-toggle">
              <Toggle checked={transparent} onChange={setTransparent} />
              {t("whiteboard.transparentBg")}
            </label>
            <label className="wb__export-toggle">
              <Toggle checked={darkMode} onChange={setDarkMode} />
              {t("whiteboard.darkMode")}
            </label>
            <div className="wb__export-actions">
              <Button variant="primary" onClick={() => void run("png")}>
                <Download size={14} />
                {t("whiteboard.downloadPng")}
              </Button>
              <Button onClick={() => void run("svg")}>
                <Download size={14} />
                {t("whiteboard.downloadSvg")}
              </Button>
            </div>
            <Button
              variant="subtle"
              onClick={() => void copyToClipboard()}
              disabled={copying}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t("whiteboard.copied") : t("whiteboard.copyToClipboard")}
            </Button>
          </div>
        </Dropdown>
      )}
    </>
  );
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
