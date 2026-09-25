import React from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

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
