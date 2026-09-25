import React, { useRef } from "react";
import { RefreshCw } from "lucide-react";
import "./ui.css";

/**
 * Shared UI kit — the single reusable component set for the whole project.
 * All colors/spacing/motion come from design tokens; no feature builds its own
 * buttons/inputs/modals (docs/00 §2.4 "Themeable từ gốc"). Larger pieces live
 * in their own files and are re-exported here, so imports stay "@/shared/ui".
 */
export { IconButton } from "./IconButton";
export { Collapsible } from "./Collapsible";
export { Modal } from "./Modal";

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
