/**
 * The elicitation form's pure model: what the user has typed, whether it
 * satisfies the agent's schema, and what goes back on the wire.
 *
 * The fold has already normalized the schema (`ElicitationSchema` in the
 * fold's generated types): one field per question, declaration order kept,
 * harness idioms collapsed. This file only knows that vocabulary. Decisions
 * are functions over present values so the component stays a thin shell.
 */

import type {
  ElicitationProperty,
  ElicitationSchema,
} from '@service-agent-fold/generated/types';

/** One field's draft value, keyed by property name. */
export type FieldValue =
  /** A free-text or single-select answer. */
  | { kind: 'text'; text: string }
  /** A single select with a custom-text escape: exactly one of the two. */
  | { kind: 'choice'; value: string | undefined; custom: string }
  | { kind: 'number'; text: string }
  | { kind: 'boolean'; checked: boolean }
  /** A multi select; `custom` is the free-text escape when the field has one. */
  | { kind: 'multi'; values: string[]; custom: string }
  | { kind: 'unsupported' };

export type FormValues = Record<string, FieldValue>;

/**
 * Patterns beyond this length, or with a quantified group that is itself
 * quantified, are not evaluated: JavaScript's regex engine cannot be
 * interrupted, and the agent supplied the pattern. The agent validates again
 * on its side, so skipping here loses nothing but an early hint.
 */
const PATTERN_MAX_LENGTH = 200;
const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)\s*[+*{]/;

/** Draft values pre-filled from the schema's defaults. */
export function initialValues(schema: ElicitationSchema): FormValues {
  const values: FormValues = {};
  for (const property of schema.properties) {
    const field = property.schema;
    switch (field.type) {
      case 'string':
        values[property.name] =
          field.options.length > 0
            ? { kind: 'choice', value: field.default ?? undefined, custom: '' }
            : { kind: 'text', text: field.default ?? '' };
        break;
      case 'number':
      case 'integer':
        values[property.name] = {
          kind: 'number',
          text: field.default == null ? '' : String(field.default),
        };
        break;
      case 'boolean':
        values[property.name] = {
          kind: 'boolean',
          checked: field.default ?? false,
        };
        break;
      case 'multi_select':
        values[property.name] = {
          kind: 'multi',
          values: [...field.default],
          custom: '',
        };
        break;
      case 'unrecognized':
        values[property.name] = { kind: 'unsupported' };
        break;
    }
  }
  return values;
}

function isBlank(value: FieldValue | undefined): boolean {
  if (!value) return true;
  switch (value.kind) {
    case 'text':
      return value.text.trim().length === 0;
    case 'choice':
      return value.value === undefined && value.custom.trim().length === 0;
    case 'number':
      return value.text.trim().length === 0;
    case 'boolean':
      return false;
    case 'multi':
      return value.values.length === 0 && value.custom.trim().length === 0;
    case 'unsupported':
      return true;
  }
}

const FORMAT_CHECKS: Record<string, (text: string) => boolean> = {
  email: (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text),
  uri: (text) => {
    try {
      new URL(text);
      return true;
    } catch {
      return false;
    }
  },
  date: (text) =>
    /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text)),
  'date-time': (text) => !Number.isNaN(Date.parse(text)),
};

function validateText(
  property: Extract<ElicitationProperty['schema'], { type: 'string' }>,
  text: string
): string | undefined {
  if (property.minLength != null && text.length < property.minLength) {
    return `At least ${property.minLength} characters`;
  }
  if (property.maxLength != null && text.length > property.maxLength) {
    return `At most ${property.maxLength} characters`;
  }
  if (property.format && FORMAT_CHECKS[property.format]?.(text) === false) {
    return `Not a valid ${property.format}`;
  }
  if (
    property.pattern &&
    property.pattern.length <= PATTERN_MAX_LENGTH &&
    !NESTED_QUANTIFIER.test(property.pattern)
  ) {
    try {
      if (!new RegExp(property.pattern).test(text)) {
        return 'Does not match the required format';
      }
    } catch {
      // An invalid pattern is the agent's problem; do not block the user.
    }
  }
  return undefined;
}

/**
 * Every field's problem, keyed by property name. Empty when the form can be
 * submitted.
 */
export function validate(
  schema: ElicitationSchema,
  values: FormValues
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const property of schema.properties) {
    const value = values[property.name];
    const required = schema.required.includes(property.name);
    if (isBlank(value)) {
      if (required && property.schema.type !== 'unrecognized') {
        errors[property.name] = 'Required';
      }
      continue;
    }
    if (!value) continue;
    const field = property.schema;
    switch (field.type) {
      case 'string': {
        if (value.kind === 'text') {
          const problem = validateText(field, value.text);
          if (problem) errors[property.name] = problem;
        } else if (value.kind === 'choice') {
          if (value.value !== undefined && value.custom.trim().length > 0) {
            errors[property.name] =
              'Choose an option or type your own, not both';
          } else if (
            value.value !== undefined &&
            !field.options.some((option) => option.value === value.value)
          ) {
            errors[property.name] = 'Not one of the offered choices';
          } else if (value.custom.trim().length > 0 && !field.customField) {
            errors[property.name] = 'Choose one of the offered choices';
          }
        }
        break;
      }
      case 'number':
      case 'integer': {
        if (value.kind !== 'number') break;
        const parsed = Number(value.text);
        if (!Number.isFinite(parsed)) {
          errors[property.name] = 'Not a number';
        } else if (field.type === 'integer' && !Number.isInteger(parsed)) {
          errors[property.name] = 'Must be a whole number';
        } else if (field.minimum != null && parsed < field.minimum) {
          errors[property.name] = `At least ${field.minimum}`;
        } else if (field.maximum != null && parsed > field.maximum) {
          errors[property.name] = `At most ${field.maximum}`;
        }
        break;
      }
      case 'multi_select': {
        if (value.kind !== 'multi') break;
        if (field.minItems != null && value.values.length < field.minItems) {
          errors[property.name] = `Choose at least ${field.minItems}`;
        } else if (
          field.maxItems != null &&
          value.values.length > field.maxItems
        ) {
          errors[property.name] = `Choose at most ${field.maxItems}`;
        }
        break;
      }
      case 'boolean':
      case 'unrecognized':
        break;
    }
  }
  return errors;
}

/**
 * The `content` for an `accept`: one key per answered field. A select with a
 * custom escape sends the choice under the property's name *or* the typed
 * text under `customField` — never both, which is the one thing the Claude
 * Code recording showed a naive client getting wrong. Blank optional fields
 * are omitted rather than sent empty.
 */
export function toContent(
  schema: ElicitationSchema,
  values: FormValues
): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const property of schema.properties) {
    const value = values[property.name];
    if (!value || isBlank(value)) continue;
    switch (value.kind) {
      case 'text':
        content[property.name] = value.text;
        break;
      case 'choice': {
        const field = property.schema;
        const custom = value.custom.trim();
        if (custom.length > 0 && field.type === 'string' && field.customField) {
          content[field.customField] = custom;
        } else if (value.value !== undefined) {
          content[property.name] = value.value;
        }
        break;
      }
      case 'number':
        content[property.name] = Number(value.text);
        break;
      case 'boolean':
        content[property.name] = value.checked;
        break;
      case 'multi': {
        const field = property.schema;
        const custom = value.custom.trim();
        if (
          custom.length > 0 &&
          field.type === 'multi_select' &&
          field.customField
        ) {
          content[field.customField] = custom;
        } else if (value.values.length > 0) {
          content[property.name] = value.values;
        }
        break;
      }
      case 'unsupported':
        break;
    }
  }
  return content;
}

/** A read-only rendering of submitted content, one line per field. */
export function describeContent(
  schema: ElicitationSchema,
  content: unknown
): { label: string; value: string }[] {
  if (typeof content !== 'object' || content === null) return [];
  const record = content as Record<string, unknown>;
  const lines: { label: string; value: string }[] = [];
  for (const property of schema.properties) {
    const label = property.title ?? property.name;
    const field = property.schema;
    const custom =
      (field.type === 'string' || field.type === 'multi_select') &&
      field.customField
        ? record[field.customField]
        : undefined;
    const raw = custom ?? record[property.name];
    if (raw === undefined || raw === null) continue;
    let value: string;
    if (Array.isArray(raw)) {
      value = raw.map((item) => optionTitle(property, String(item))).join(', ');
    } else if (typeof raw === 'string') {
      value = custom === undefined ? optionTitle(property, raw) : raw;
    } else {
      value = String(raw);
    }
    lines.push({ label, value });
  }
  return lines;
}

function optionTitle(property: ElicitationProperty, value: string): string {
  const field = property.schema;
  if (field.type !== 'string' && field.type !== 'multi_select') return value;
  return field.options.find((option) => option.value === value)?.title ?? value;
}

/** The host of a URL-mode request, for the consent card, or the raw text. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Punycode (`xn--`) anywhere in the host: warn before the user opens it. */
export function looksSuspicious(url: string): boolean {
  return urlHost(url)
    .split('.')
    .some((label) => label.startsWith('xn--'));
}
