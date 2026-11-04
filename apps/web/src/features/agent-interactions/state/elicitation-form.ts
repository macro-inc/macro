/**
 * The elicitation form's pure model: what the user has typed, whether it
 * satisfies the agent's schema, and what goes back on the wire.
 *
 * The fold has already normalized the schema (`ElicitationSchema` in the
 * fold's generated types): one field per question, declaration order kept,
 * harness idioms collapsed. This file only knows that vocabulary. Decisions
 * are functions over present values so the component stays a thin shell.
 *
 * Draft values are deliberately *not* the answer's shape: a number is held as
 * the text being typed, and a single choice is either unselected, an offered
 * option, or custom text. Picking Other with an empty text box is distinct
 * from not selecting anything. Every match is `.exhaustive()`, so a new
 * variant must be handled explicitly.
 *
 * What this does not validate: `pattern` and `format`. Both are the agent's
 * to enforce and it does, on every answer, before acting. Re-implementing
 * them here bought an early hint and cost an unbounded, agent-supplied regex
 * on the browser's main thread. The client checks what it can check cheaply
 * and totally - required, lengths, bounds, membership, item counts - and
 * nothing else.
 */

import type {
  ElicitationPropertySchema,
  ElicitationSchema,
} from '@service-agent-fold/generated/types';
import { match, P } from 'ts-pattern';

/** A single-choice draft cannot hold an option and custom text together. */
export type SingleSelection =
  | { kind: 'none' }
  | { kind: 'option'; value: string }
  | { kind: 'custom'; text: string };

/** One field's draft value, keyed by property name. */
export type FieldValue =
  /** Free text, and the raw text of a number while it is being typed. */
  | { kind: 'text'; text: string }
  | { kind: 'single_select'; selection: SingleSelection }
  /** Multiple choices, or the free-text escape when the schema allows one. */
  | { kind: 'multi_select'; values: string[]; custom: string | undefined }
  | { kind: 'boolean'; checked: boolean }
  /** A property type this client cannot render. */
  | { kind: 'unsupported' };

export type FormValues = Record<string, FieldValue>;

/** A multi-select and its options. */
type MultiSelectSchema = Extract<
  ElicitationPropertySchema,
  { type: 'multi_select' }
>;
type MultiSelectValue = Extract<FieldValue, { kind: 'multi_select' }>;

/** Draft values pre-filled from the schema's defaults. */
export function initialValues(schema: ElicitationSchema): FormValues {
  const values: FormValues = {};
  for (const property of schema.properties) {
    values[property.name] = initialValue(property.schema);
  }
  return values;
}

function initialValue(field: ElicitationPropertySchema): FieldValue {
  return match(field)
    .with(
      { type: 'string', options: P.when((options) => options.length > 0) },
      (select): FieldValue => ({
        kind: 'single_select',
        selection:
          select.default == null
            ? { kind: 'none' }
            : { kind: 'option', value: select.default },
      })
    )
    .with(
      { type: 'string' },
      (text): FieldValue => ({
        kind: 'text',
        text: text.default ?? '',
      })
    )
    .with(
      { type: 'number' },
      { type: 'integer' },
      (number): FieldValue => ({
        kind: 'text',
        text: number.default == null ? '' : String(number.default),
      })
    )
    .with(
      { type: 'boolean' },
      (flag): FieldValue => ({
        kind: 'boolean',
        checked: flag.default ?? false,
      })
    )
    .with(
      { type: 'multi_select' },
      (multi): FieldValue => ({
        kind: 'multi_select',
        values: [...multi.default],
        custom: undefined,
      })
    )
    .with({ type: 'unrecognized' }, (): FieldValue => ({ kind: 'unsupported' }))
    .exhaustive();
}

/**
 * How many answers a select holds: its checked values, plus the custom text
 * when one was typed. Custom text is an answer, which is what `minItems` and
 * `maxItems` are counting.
 */
function selected(value: MultiSelectValue): number {
  return value.values.length + (value.custom?.trim() ? 1 : 0);
}

function isBlank(value: FieldValue | undefined): boolean {
  if (!value) return true;
  return match(value)
    .with({ kind: 'text' }, (text) => text.text.trim().length === 0)
    .with({ kind: 'single_select' }, ({ selection }) =>
      match(selection)
        .with({ kind: 'none' }, () => true)
        .with({ kind: 'option' }, () => false)
        .with({ kind: 'custom' }, ({ text }) => text.trim().length === 0)
        .exhaustive()
    )
    .with({ kind: 'multi_select' }, (select) => selected(select) === 0)
    .with({ kind: 'boolean' }, () => false)
    .with({ kind: 'unsupported' }, () => true)
    .exhaustive();
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
    const problem = validateField(
      property.schema,
      values[property.name],
      schema.required.includes(property.name)
    );
    if (problem) errors[property.name] = problem;
  }
  return errors;
}

function validateField(
  field: ElicitationPropertySchema,
  value: FieldValue | undefined,
  required: boolean
): string | undefined {
  // A field this client cannot render can never be filled in, so a required
  // one has no valid answer: the user's move is decline, not submit.
  if (field.type === 'unrecognized') {
    return required
      ? `This client cannot answer a ${field.typeName} field`
      : undefined;
  }
  if (isBlank(value)) return required ? 'Required' : undefined;
  if (!value) return undefined;

  return match(field)
    .with({ type: 'string' }, (text) =>
      value.kind === 'single_select'
        ? match(value.selection)
            .with({ kind: 'none' }, () => undefined)
            .with({ kind: 'option' }, ({ value }) =>
              text.options.some((option) => option.value === value)
                ? undefined
                : 'Not one of the offered choices'
            )
            .with({ kind: 'custom' }, () =>
              text.customField ? undefined : 'Choose one of the offered choices'
            )
            .exhaustive()
        : value.kind === 'text'
          ? length(text, value.text)
          : undefined
    )
    .with({ type: 'number' }, { type: 'integer' }, (number) =>
      value.kind === 'text'
        ? bounds(number, value.text, field.type === 'integer')
        : undefined
    )
    .with({ type: 'multi_select' }, (multi) =>
      value.kind === 'multi_select' ? count(multi, value) : undefined
    )
    .with({ type: 'boolean' }, () => undefined)
    .exhaustive();
}

function length(
  field: Extract<ElicitationPropertySchema, { type: 'string' }>,
  text: string
): string | undefined {
  if (field.minLength != null && text.length < field.minLength) {
    return `At least ${field.minLength} characters`;
  }
  if (field.maxLength != null && text.length > field.maxLength) {
    return `At most ${field.maxLength} characters`;
  }
  return undefined;
}

function bounds(
  field: Extract<ElicitationPropertySchema, { type: 'number' | 'integer' }>,
  text: string,
  whole: boolean
): string | undefined {
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return 'Not a number';
  if (whole && !Number.isInteger(parsed)) return 'Must be a whole number';
  if (field.minimum != null && parsed < field.minimum) {
    return `At least ${field.minimum}`;
  }
  if (field.maximum != null && parsed > field.maximum) {
    return `At most ${field.maximum}`;
  }
  return undefined;
}

function count(
  field: Extract<ElicitationPropertySchema, { type: 'multi_select' }>,
  value: MultiSelectValue
): string | undefined {
  const chosen = selected(value);
  if (field.minItems != null && chosen < field.minItems) {
    return `Choose at least ${field.minItems}`;
  }
  if (field.maxItems != null && chosen > field.maxItems) {
    return `Choose at most ${field.maxItems}`;
  }
  return membership(field, value);
}

/** A select's values must be offered, and its custom text must be allowed. */
function membership(
  field: MultiSelectSchema,
  value: MultiSelectValue
): string | undefined {
  if (value.custom?.trim() && !field.customField) {
    return 'Choose one of the offered choices';
  }
  const stray = value.values.some(
    (chosen) => !field.options.some((option) => option.value === chosen)
  );
  return stray ? 'Not one of the offered choices' : undefined;
}

/**
 * The `content` for an `accept`: one key per answered field. A select with a
 * custom escape sends the choice under the property's name *or* the typed
 * text under `customField` - never both, which is the one thing the Claude
 * Code recording showed a naive client getting wrong. Blank optional fields
 * are omitted rather than sent empty.
 */
export function toContent(
  schema: ElicitationSchema,
  values: FormValues
): Record<string, string | number | boolean | string[]> {
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const property of schema.properties) {
    const value = values[property.name];
    const field = property.schema;
    if (!value || isBlank(value) || field.type === 'unrecognized') continue;
    match(value)
      .with({ kind: 'text' }, (text) => {
        content[property.name] =
          field.type === 'number' || field.type === 'integer'
            ? Number(text.text)
            : text.text;
      })
      .with({ kind: 'boolean' }, (flag) => {
        content[property.name] = flag.checked;
      })
      .with({ kind: 'single_select' }, ({ selection }) => {
        match(selection)
          .with({ kind: 'none' }, () => {})
          .with({ kind: 'option' }, ({ value }) => {
            content[property.name] = value;
          })
          .with({ kind: 'custom' }, ({ text }) => {
            if (field.type === 'string' && field.customField) {
              content[field.customField] = text.trim();
            }
          })
          .exhaustive();
      })
      .with({ kind: 'multi_select' }, (select) => {
        const custom = select.custom?.trim();
        const customField =
          field.type === 'multi_select' ? field.customField : null;
        if (custom && customField) {
          content[customField] = custom;
        } else if (select.values.length > 0) {
          content[property.name] = select.values;
        }
      })
      .with({ kind: 'unsupported' }, () => {})
      .exhaustive();
  }
  return content;
}
