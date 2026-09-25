import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { Field, NumberStepper, Select, Slider, TextInput, Toggle } from "@/shared/ui";
import type { FieldDef, SettingsSchema } from "./schema";
import { useFeatureValues, useSettingsStore } from "./settingsStore";

/**
 * Renders a feature's settings form straight from its schema — no per-feature
 * form code (docs/core-he-thong/02-settings-engine.md §3). Changes apply live.
 */
export function SettingsForm({
  featureId,
  schema,
}: {
  featureId: string;
  schema: SettingsSchema;
}) {
  const { t } = useTranslation();
  const values = useFeatureValues(featureId);
  const setValue = useSettingsStore((s) => s.setValue);

  return (
    <div>
      {Object.entries(schema).map(([key, field]) => {
        if (field.showIf && !field.showIf(values)) return null;
        return (
          <SettingsField
            key={key}
            field={field}
            value={values[key] ?? field.default}
            onChange={(v) => setValue(featureId, key, v)}
            t={t}
          />
        );
      })}
    </div>
  );
}

const TEXT_COMMIT_DELAY_MS = 700;

/**
 * Text settings commit when typing pauses (or on blur / Enter), not per
 * keystroke — features react to their values live, and e.g. the Wallhaven
 * keyword would otherwise fire one search + download per letter.
 */
function DebouncedTextInput({
  value,
  onCommit,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };

  // follow outside changes (reset, import…) unless the user is mid-edit
  useEffect(() => {
    if (pending.current === null) setDraft(value);
  }, [value]);

  const flush = () => {
    window.clearTimeout(timer.current);
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    if (next !== latest.current.value) latest.current.onCommit(next);
  };

  // closing the form mid-typing must SAVE the edit, not drop it (AGENTS.md §8)
  useEffect(() => flush, []);

  return (
    <TextInput
      {...rest}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        pending.current = e.target.value;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, TEXT_COMMIT_DELAY_MS);
      }}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === "Enter") flush();
      }}
    />
  );
}

function SettingsField({
  field,
  value,
  onChange,
  t,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  t: (key: string) => string;
}) {
  const label = t(field.label);
  const description = field.description ? t(field.description) : undefined;

  switch (field.type) {
    case "toggle":
      return (
        <Field label={label} description={description} inline>
          <Toggle checked={value === true} onChange={onChange} />
        </Field>
      );
    case "select":
      return (
        <Field label={label} description={description} inline>
          <div style={{ maxWidth: 240 }}>
            <Select
              value={(value as string) ?? ""}
              onChange={onChange}
              options={field.options.map((o) => ({ value: o.value, label: t(o.label) }))}
            />
          </div>
        </Field>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? (value as string[]) : (field.default ?? []);
      const min = field.min ?? 1;
      return (
        <Field label={label} description={description}>
          <div className="ui-checkchips" role="group" aria-label={label}>
            {field.options.map((o) => {
              const checked = selected.includes(o.value);
              const locked = checked && selected.length <= min;
              return (
                <label
                  key={o.value}
                  className={`ui-checkchip ${checked ? "ui-checkchip--on" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={() =>
                      onChange(
                        checked
                          ? selected.filter((v) => v !== o.value)
                          : [...selected, o.value],
                      )
                    }
                  />
                  {o.icon && <span aria-hidden>{o.icon}</span>}
                  {t(o.label)}
                </label>
              );
            })}
          </div>
        </Field>
      );
    }
    case "text":
      return (
        <Field label={label} description={description}>
          <DebouncedTextInput
            type={field.secret ? "password" : "text"}
            autoComplete="off"
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
            value={(value as string) ?? ""}
            onCommit={onChange}
          />
        </Field>
      );
    case "number":
      return (
        <Field label={label} description={description} inline={true}>
          <NumberStepper
            value={value === undefined || value === null ? field.default ?? 0 : (value as number)}
            onChange={onChange as (v: number) => void}
            min={field.min}
            max={field.max}
          />
        </Field>
      );
    case "slider":
      return (
        <Field label={label} description={description}>
          <Slider
            value={(value as number) ?? field.min}
            onChange={onChange}
            min={field.min}
            max={field.max}
            step={field.step}
            commitOnRelease={field.commitOnRelease}
          />
        </Field>
      );
    case "color":
      return (
        <Field label={label} description={description} inline>
          <input
            type="color"
            value={(value as string) ?? "#000000"}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );
    default:
      return null;
  }
}
