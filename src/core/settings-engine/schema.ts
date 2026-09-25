/**
 * Schema-driven settings — docs/core-he-thong/02-settings-engine.md §3.
 * Each feature declares a schema; the Settings modal renders the form automatically.
 */

export type FieldValues = Record<string, unknown>;

interface BaseField {
  /** i18n key for the label */
  label: string;
  /** i18n key for helper text under the field */
  description?: string;
  /** hide the field unless the predicate over current values passes */
  showIf?: (values: FieldValues) => boolean;
}

export interface TextField extends BaseField {
  type: "text";
  default?: string;
  placeholder?: string;
  /** password-mask, never logged (API keys...) */
  secret?: boolean;
}

export interface NumberField extends BaseField {
  type: "number";
  default?: number;
  min?: number;
  max?: number;
}

export interface ToggleField extends BaseField {
  type: "toggle";
  default?: boolean;
}

export interface SelectField extends BaseField {
  type: "select";
  options: Array<{ value: string; label: string }>;
  default?: string;
}

/** Several values at once, rendered as checkbox chips. Value is a string[]. */
export interface MultiSelectField extends BaseField {
  type: "multiselect";
  options: Array<{ value: string; label: string; icon?: string }>;
  default?: string[];
  /** refuse to uncheck below this many (default 1) */
  min?: number;
}

export interface SliderField extends BaseField {
  type: "slider";
  default?: number;
  min: number;
  max: number;
  step?: number;
  /** apply only when the drag ends — for values costly to apply live */
  commitOnRelease?: boolean;
}

export interface ColorField extends BaseField {
  type: "color";
  default?: string;
}

export type FieldDef =
  | TextField
  | NumberField
  | ToggleField
  | SelectField
  | MultiSelectField
  | SliderField
  | ColorField;

export type SettingsSchema = Record<string, FieldDef>;

export function defineSchema<T extends SettingsSchema>(schema: T): T {
  return schema;
}

/** Default values extracted from a schema (used before the user changes anything). */
export function schemaDefaults(schema: SettingsSchema | undefined): FieldValues {
  const out: FieldValues = {};
  if (!schema) return out;
  for (const [key, field] of Object.entries(schema)) {
    if (field.default !== undefined) out[key] = field.default;
  }
  return out;
}
