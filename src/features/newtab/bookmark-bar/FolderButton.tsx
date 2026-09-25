import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Folder } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { faviconFor, type BookmarkItem } from "./bookmarks-api";

/** Site favicon, falling back to the title's first letter. */
export function Favicon({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconFor(url);
  if (!src || failed) {
    return <span className="bookmark-item__letter">{(title || url)[0]?.toUpperCase() ?? "?"}</span>;
  }
  return (
    <img
      className="bookmark-item__icon"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** A bookmark folder: opens a portal menu that drills into nested folders. */
export function FolderButton({ item, dir = "up" }: { item: BookmarkItem; dir?: "up" | "down" }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [folderStack, setFolderStack] = useState<BookmarkItem[]>([item]);
  const [slideDirection, setSlideDirection] = useState<number>(1);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<React.CSSProperties>({});

  const handleOpen = () => {
    setFolderStack([item]);
    setSlideDirection(1);
    setOpen((o) => !o);
  };

  const pushFolder = (sub: BookmarkItem) => {
    setSlideDirection(1);
    setFolderStack((prev) => [...prev, sub]);
  };

  const popFolder = () => {
    setSlideDirection(-1);
    setFolderStack((prev) => (prev.length > 1 ? prev.slice(0, prev.length - 1) : prev));
  };

  const currentFolder = folderStack[folderStack.length - 1] ?? item;
  const canGoBack = folderStack.length > 1;

  useEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuWidth = 260;
    let left = r.left + r.width / 2 - menuWidth / 2;
    // Keep within screen bounds
    left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, left));

    if (dir === "down") {
      setMenuPos({
        position: "fixed",
        left: `${left}px`,
        top: `${r.bottom + 8}px`,
        width: `${menuWidth}px`,
      });
    } else {
      setMenuPos({
        position: "fixed",
        left: `${left}px`,
        bottom: `${window.innerHeight - r.top + 8}px`,
        width: `${menuWidth}px`,
      });
    }

    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest(".bookmark-folder__menu") && e.target !== btn) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Delay adding listeners so the same click that opened doesn't close
    const id = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, dir]);

  const children = currentFolder.children ?? [];

  return (
    <div className="bookmark-folder">
      <button ref={btnRef} className="bookmark-item" onClick={handleOpen} title={item.title}>
        <span className="bookmark-item__letter">
          <Folder size={15} />
        </span>
        <span className="bookmark-item__label">{item.title}</span>
      </button>

      {open &&
        createPortal(
          <div className="bookmark-folder__menu" style={menuPos}>
            <div className="bookmark-folder__header">
              {canGoBack ? (
                <button
                  type="button"
                  className="bookmark-folder__back-btn"
                  onClick={popFolder}
                  title={t("bookmarks.back")}
                  aria-label={t("bookmarks.back")}
                >
                  <ChevronLeft size={16} />
                </button>
              ) : (
                <Folder size={15} className="bookmark-folder__header-icon" />
              )}
              <span className="bookmark-folder__title" title={currentFolder.title}>
                {currentFolder.title}
              </span>
              {children.length > 0 && (
                <span className="bookmark-folder__badge">{children.length}</span>
              )}
            </div>

            <div className="bookmark-folder__content-wrap">
              <AnimatePresence mode="wait" custom={slideDirection} initial={false}>
                <motion.div
                  key={currentFolder.id}
                  custom={slideDirection}
                  variants={{
                    enter: (d: number) => ({ x: d > 0 ? 24 : -24, opacity: 0 }),
                    center: { x: 0, opacity: 1 },
                    exit: (d: number) => ({ x: d > 0 ? -24 : 24, opacity: 0 }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="bookmark-folder__list"
                >
                  {children.length === 0 ? (
                    <div className="bookmark-folder__empty">{t("bookmarks.emptyFolder")}</div>
                  ) : (
                    children.map((c) =>
                      c.url ? (
                        <a
                          key={c.id}
                          className="bookmark-folder__entry bookmark-folder__entry--link"
                          href={c.url}
                        >
                          <img
                            src={faviconFor(c.url)}
                            alt=""
                            loading="lazy"
                            className="bookmark-folder__entry-icon"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = "none";
                            }}
                          />
                          <span className="bookmark-folder__entry-title">{c.title || c.url}</span>
                        </a>
                      ) : (
                        <button
                          key={c.id}
                          type="button"
                          className="bookmark-folder__entry bookmark-folder__entry--folder"
                          onClick={() => pushFolder(c)}
                        >
                          <Folder size={15} className="bookmark-folder__entry-folder-icon" />
                          <span className="bookmark-folder__entry-title">{c.title}</span>
                          <span className="bookmark-folder__sub-count">
                            {c.children?.length ?? 0}
                          </span>
                          <ChevronRight size={14} className="bookmark-folder__chevron" />
                        </button>
                      ),
                    )
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
