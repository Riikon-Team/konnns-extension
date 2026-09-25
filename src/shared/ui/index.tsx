import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Eye, RefreshCw, X, type LucideIcon } from "lucide-react";
import "./ui.css";

/**
 * Shared UI kit — the single reusable component set for the whole project.
 * All colors/spacing/motion come from design tokens; no feature builds its own
 * buttons/inputs/modals (docs/00 §2.4 "Themeable từ gốc").
 */

/* ---------- Button ---------- */
type ButtonVariant = "primary" | "subtle" | "ghost" | "danger";

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" }
>(function Button({ variant = "subtle", size, className = "", ...rest }, ref) {
  const cls = ["ui-btn", `ui-btn--${variant}`, size === "sm" && "ui-btn--sm", className]
    .filter(Boolean)
    .join(" ");
  return <button ref={ref} type="button" className={cls} {...rest} />;
});

/* ---------- ReloadButton (force refresh, bypasses cache) ---------- */
export function ReloadButton({
  onClick,
  busy,
  label,
  className = "",
}: {
  onClick: () => void;
  busy?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`ui-reload ${busy ? "ui-reload--spin" : ""} ${className}`}
      aria-label={label ?? "Reload"}
      title={label ?? "Reload"}
      onClick={onClick}
    >
      <RefreshCw size={14} />
    </button>
  );
}

/* ---------- IconButton ---------- */
export function IconButton({
  label,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={`ui-iconbtn ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    />
  );
}

/* ---------- Toggle ---------- */
export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="ui-toggle"
      onClick={() => onChange(!checked)}
    >
      <span className="ui-toggle__thumb" />
    </button>
  );
}

/* ---------- TextInput ---------- */
export const TextInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function TextInput({ className = "", ...rest }, ref) {
  return <input ref={ref} className={`ui-input ${className}`} {...rest} />;
});

/* ---------- NumberStepper (input + /- buttons) ---------- */
export function NumberStepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const step = 1;
  const canDec = min === undefined || value > min;
  const canInc = max === undefined || value < max;

  return (
    <div className="ui-number-stepper">
      <button
        type="button"
        className="ui-number-stepper__btn"
        disabled={!canDec}
        onClick={() => onChange(value - step)}
        aria-label="Decrease"
      >
        −
      </button>
      <input
        type="number"
        className="ui-number-stepper__input"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!isNaN(v)) {
            if (min !== undefined && v < min) onChange(min);
            else if (max !== undefined && v > max) onChange(max);
            else onChange(v);
          }
        }}
      />
      <button
        type="button"
        className="ui-number-stepper__btn"
        disabled={!canInc}
        onClick={() => onChange(value + step)}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}

/* ---------- Select / Combobox (styled, portal-based) ---------- */
export { Select, Combobox, Dropdown, type Option } from "./Select";
export { DatePicker } from "./DatePicker";

/* ---------- Slider ---------- */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  commitOnRelease = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /**
   * Only call onChange when the drag ends (pointer up / key up / blur).
   * For values that are expensive to apply live — e.g. UI scale re-lays out
   * the whole page on every step.
   */
  commitOnRelease?: boolean;
}) {
  const [draft, setDraft] = React.useState<number | null>(null);
  // a ref too: pointerup can fire before React has re-rendered the last input
  const draftRef = useRef<number | null>(null);
  const shown = draft ?? value;

  const commit = () => {
    const next = draftRef.current;
    if (next === null) return;
    draftRef.current = null;
    setDraft(null);
    if (next !== value) onChange(next);
  };

  return (
    <div className="ui-slider__row">
      <input
        type="range"
        className="ui-slider"
        value={shown}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!commitOnRelease) return onChange(v);
          draftRef.current = v;
          setDraft(v);
        }}
        onPointerUp={commitOnRelease ? commit : undefined}
        onKeyUp={commitOnRelease ? commit : undefined}
        onBlur={commitOnRelease ? commit : undefined}
        title={`${shown}`}
      />
      <div className="ui-slider__value">
        {shown}
      </div>
    </div>
  );
}

/* ---------- Segmented ---------- */
export function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="ui-segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`ui-segmented__item ${o.value === value ? "ui-segmented__item--active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Collapsible section ---------- */
/**
 * Titled block that folds/unfolds from its header (animated), remembering the
 * choice per `id` in localStorage. Used by the popup's sections so every block
 * — apps, audio, page tools — looks and behaves the same.
 */
export function Collapsible({
  id,
  title,
  icon: Icon,
  count,
  hint,
  action,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  icon?: LucideIcon;
  count?: number;
  /** small muted note next to the title (e.g. "not available here") */
  hint?: React.ReactNode;
  /** extra control on the right of the header (stays clickable on its own) */
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const key = `ui.collapsible.${id}`;
  const [open, setOpen] = React.useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? defaultOpen : saved === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () =>
    setOpen((v) => {
      try {
        localStorage.setItem(key, v ? "0" : "1");
      } catch {
        /* storage blocked — still toggles, just forgets */
      }
      return !v;
    });
  const bodyId = `coll-${id}`;

  return (
    <section className={`ui-coll ${open ? "ui-coll--open" : ""}`}>
      <div className="ui-coll__head">
        <button type="button" className="ui-coll__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          {Icon && (
            <span className="ui-coll__icon">
              <Icon size={13} />
            </span>
          )}
          <span className="ui-coll__title">{title}</span>
          {count !== undefined && <span className="ui-coll__count">{count}</span>}
          {hint && <span className="ui-coll__hint">{hint}</span>}
          <ChevronDown size={14} className="ui-coll__chev" />
        </button>
        {action}
      </div>
      <div className="ui-coll__body" id={bodyId}>
        <div className="ui-coll__inner">{children}</div>
      </div>
    </section>
  );
}

/* ---------- Field (label + control + description/error) ---------- */
export function Field({
  label,
  description,
  error,
  inline = false,
  children,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: string;
  inline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="ui-field">
      {inline ? (
        <div className="ui-field__row">
          <span className="ui-field__label">{label}</span>
          {children}
        </div>
      ) : (
        <>
          <span className="ui-field__label">{label}</span>
          {children}
        </>
      )}
      {description && <span className="ui-field__desc">{description}</span>}
      {error && <span className="ui-field__error">{error}</span>}
    </div>
  );
}

/* ---------- Card ---------- */
export function Card({
  elevated,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { elevated?: boolean }) {
  const cls = ["ui-card", elevated && "ui-card--elevated", className].filter(Boolean).join(" ");
  return <div className={cls} {...rest} />;
}

/* ---------- Skeleton ---------- */
export function Skeleton({
  width,
  height,
  radius,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  radius?: string;
  className?: string;
}) {
  return (
    <div
      className={`ui-skeleton ${className}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden
    />
  );
}

/* ---------- Modal ---------- */
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
  /**
   * Adds a "look through" eye button to the header: while it is held, the
   * modal and backdrop go transparent so the page behind shows — e.g. to see
   * a setting's effect without closing Settings. The string is its label.
   */
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
                      // held, not toggled: capture keeps the release even if
                      // the pointer drifts off the button while looking
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
