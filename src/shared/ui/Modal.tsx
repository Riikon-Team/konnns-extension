import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, X } from "lucide-react";
import { IconButton } from "./IconButton";

export function Modal({
  open,
  onClose,
  title,
  width,
  peekLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  width?: number | string;
  peekLabel?: string;
  children: React.ReactNode;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [peek, setPeek] = React.useState(false);
  useEffect(() => {
    if (!open) setPeek(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={`ui-modal-overlay ${peek ? "ui-modal-overlay--peek" : ""}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className={`ui-modal ${peek ? "ui-modal--peek" : ""}`}
            style={{ width }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {title && (
              <div className="ui-modal__header">
                <span className="ui-modal__title">{title}</span>
                <span className="ui-modal__actions">
                  {peekLabel && (
                    <IconButton
                      label={peekLabel}
                      className={`ui-modal__peek ${peek ? "ui-modal__peek--on" : ""}`}
                      aria-pressed={peek}
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setPeek(true);
                      }}
                      onPointerUp={() => setPeek(false)}
                      onPointerCancel={() => setPeek(false)}
                      onLostPointerCapture={() => setPeek(false)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          setPeek(true);
                        }
                      }}
                      onKeyUp={() => setPeek(false)}
                      onBlur={() => setPeek(false)}
                    >
                      <Eye size={17} />
                    </IconButton>
                  )}
                  <IconButton label="Close" onClick={onClose}>
                    <X size={18} />
                  </IconButton>
                </span>
              </div>
            )}
            <div className="ui-modal__body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
