import {
  type RoutineKnob,
  RoutineKnobEntityType,
} from '@service-scheduled-action/generated/schemas';
import { match } from 'ts-pattern';
import { z } from 'zod';

/**
 * A value a code step reads as `knobs.<name>`, which its owner changes
 * without new code. The scheduler owns these shapes and limits
 * (`routine_program`'s `knob.rs` and `validate.rs`).
 */
export type Knob =
  | { type: 'text'; name: string; label: string; value: string }
  | {
      type: 'number';
      name: string;
      label: string;
      value: number;
      min?: number;
      max?: number;
    }
  | { type: 'boolean'; name: string; label: string; value: boolean }
  | {
      type: 'choice';
      name: string;
      label: string;
      value: string;
      options: string[];
    }
  | {
      type: 'question';
      name: string;
      /** The condition as a clause that reads inside the step's sentence. */
      label: string;
      /** The question AI is asked. */
      value: string;
    }
  | {
      type: 'entity';
      name: string;
      label: string;
      /** The kinds of item the owner may pick. */
      entity_types: KnobEntityType[];
      /** The item picked; none yet in a starter. */
      value: KnobEntity | null;
    };

/** A kind of item an entity knob names. */
export type KnobEntityType = RoutineKnobEntityType;

/** The item an entity knob names. */
export type KnobEntity = { type: KnobEntityType; id: string };

/** What each kind of item is called, for its owner. */
export function entityNoun(type: KnobEntityType): string {
  return match(type)
    .with('channel', () => 'channel')
    .with('document', () => 'document')
    .with('project', () => 'folder')
    .with('database', () => 'database')
    .with('user', () => 'person')
    .exhaustive();
}

/** The noun for what an entity knob may hold: its one kind, or "item". */
export function entityKnobNoun(knob: { entity_types: KnobEntityType[] }) {
  const [only, ...rest] = knob.entity_types;
  return only && !rest.length ? entityNoun(only) : 'item';
}

export const KNOB_LIMITS = {
  text: 500,
  question: 300,
} as const;

const knobName = z.string().regex(/^[a-z][A-Za-z0-9]{0,31}$/);

export const knobSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    name: knobName,
    label: z.string(),
    value: z.string(),
  }),
  z.object({
    type: z.literal('number'),
    name: knobName,
    label: z.string(),
    value: z.number(),
    min: z
      .number()
      .nullish()
      .transform((min) => min ?? undefined),
    max: z
      .number()
      .nullish()
      .transform((max) => max ?? undefined),
  }),
  z.object({
    type: z.literal('boolean'),
    name: knobName,
    label: z.string(),
    value: z.boolean(),
  }),
  z.object({
    type: z.literal('choice'),
    name: knobName,
    label: z.string(),
    value: z.string(),
    options: z.array(z.string()),
  }),
  z.object({
    type: z.literal('question'),
    name: knobName,
    label: z.string(),
    value: z.string(),
  }),
  z.object({
    type: z.literal('entity'),
    name: knobName,
    label: z.string(),
    entity_types: z.array(z.enum(RoutineKnobEntityType)),
    value: z
      .object({ type: z.enum(RoutineKnobEntityType), id: z.string() })
      .nullish()
      .transform((value) => value ?? null),
  }),
]) satisfies z.ZodType<Knob>;

/** A stored knob for the editor: `min` and `max` only when set. */
export function knobFromWire(knob: RoutineKnob): Knob {
  return match(knob)
    .returnType<Knob>()
    .with({ type: 'number' }, ({ min, max, ...rest }) => ({
      ...rest,
      ...(min == null ? {} : { min }),
      ...(max == null ? {} : { max }),
    }))
    .with({ type: 'entity' }, ({ value, ...rest }) => ({
      ...rest,
      value: value ?? null,
    }))
    .otherwise((knob) => knob);
}

/** A knob as stored: `min` and `max` only when set. */
export function knobToWire(knob: Knob): Knob {
  if (knob.type !== 'number') return knob;
  const { min, max, ...rest } = knob;
  return {
    ...rest,
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

/** How a knob's value reads in a sentence. */
export function knobText(knob: Knob): string {
  return (
    match(knob)
      .with({ type: 'boolean' }, (knob) => (knob.value ? 'yes' : 'no'))
      .with({ type: 'number' }, (knob) => String(knob.value))
      .with({ type: 'question' }, (knob) => knob.label)
      .with({ type: 'text' }, { type: 'choice' }, (knob) => knob.value)
      // Plain text has no name to show; the step's sentence shows the item.
      .with({ type: 'entity' }, (knob) =>
        knob.value
          ? `the chosen ${entityKnobNoun(knob)}`
          : `a ${entityKnobNoun(knob)}`
      )
      .exhaustive()
  );
}

/** A run of a step's sentence: plain words, or where a knob shows. */
export type SentencePart =
  | { kind: 'text'; text: string }
  | { kind: 'knob'; knob: Knob };

/**
 * A sentence split into words and knobs, or undefined when a slot is
 * malformed, names no knob, or is written the wrong way for its knob
 * (`{?name}` for questions, `{name}` for the rest). Saving rejects those,
 * so this only fails for a step that wasn't saved.
 */
export function sentenceParts(
  sentence: string,
  knobs: readonly Knob[]
): SentencePart[] | undefined {
  const parts: SentencePart[] = [];
  let rest = sentence;
  while (rest) {
    const open = rest.search(/[{}]/);
    if (open === -1) {
      parts.push({ kind: 'text', text: rest });
      break;
    }
    if (rest[open] === '}') return undefined;
    if (open > 0) parts.push({ kind: 'text', text: rest.slice(0, open) });
    const close = rest.indexOf('}', open);
    if (close === -1) return undefined;
    const inner = rest.slice(open + 1, close);
    const question = inner.startsWith('?');
    const name = question ? inner.slice(1) : inner;
    const knob = knobs.find((knob) => knob.name === name);
    if (!knob || (knob.type === 'question') !== question) return undefined;
    parts.push({ kind: 'knob', knob });
    rest = rest.slice(close + 1);
  }
  return parts;
}

/** A step's sentence with its knobs' values filled in, as plain text. */
export function sentenceText(
  sentence: string | undefined,
  knobs: readonly Knob[]
): string | undefined {
  if (!sentence?.trim()) return undefined;
  const parts = sentenceParts(sentence, knobs);
  return parts
    ?.map((part) => (part.kind === 'text' ? part.text : knobText(part.knob)))
    .join('');
}

/** The knobs a sentence doesn't show, which the step lists as settings. */
export function knobsOutsideSentence(
  sentence: string | undefined,
  knobs: readonly Knob[]
): Knob[] {
  const parts = sentence ? sentenceParts(sentence, knobs) : undefined;
  if (!parts) return [...knobs];
  const shown = new Set(
    parts.flatMap((part) => (part.kind === 'knob' ? [part.knob.name] : []))
  );
  return knobs.filter((knob) => !shown.has(knob.name));
}

/** Why `value` can't be `knob`'s value, or undefined when it can. */
export function knobValueProblem(
  knob: Knob,
  value: Knob['value']
): string | undefined {
  return match(knob)
    .with({ type: 'text' }, () =>
      typeof value !== 'string'
        ? 'Enter text.'
        : [...value].length > KNOB_LIMITS.text
          ? `Use at most ${KNOB_LIMITS.text} characters.`
          : undefined
    )
    .with({ type: 'question' }, () =>
      typeof value !== 'string' || !value.trim()
        ? 'Write the question AI should answer.'
        : [...value].length > KNOB_LIMITS.question
          ? `Use at most ${KNOB_LIMITS.question} characters.`
          : undefined
    )
    .with({ type: 'number' }, (knob) => {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return 'Enter a number.';
      if (knob.min !== undefined && value < knob.min)
        return `Use ${knob.min} or more.`;
      if (knob.max !== undefined && value > knob.max)
        return `Use ${knob.max} or less.`;
      return undefined;
    })
    .with({ type: 'choice' }, (knob) =>
      typeof value === 'string' && knob.options.includes(value)
        ? undefined
        : 'Pick one of the options.'
    )
    .with({ type: 'boolean' }, () =>
      typeof value === 'boolean' ? undefined : 'Turn it on or off.'
    )
    .with({ type: 'entity' }, (knob) =>
      isEntityOf(knob, value) ? undefined : `Pick a ${entityKnobNoun(knob)}.`
    )
    .exhaustive();
}

/** Whether `value` is an item of a kind `knob` allows. */
function isEntityOf(
  knob: { entity_types: KnobEntityType[] },
  value: Knob['value']
): value is KnobEntity {
  return (
    typeof value === 'object' &&
    value !== null &&
    knob.entity_types.includes(value.type)
  );
}

/**
 * `knobs` with `name` set to `value`; a value of another knob's type leaves
 * it as it was. The caller checks the value first.
 */
export function withKnobValue(
  knobs: readonly Knob[],
  name: string,
  value: Knob['value']
): Knob[] {
  return knobs.map((knob) =>
    knob.name === name ? withValue(knob, value) : knob
  );
}

function withValue(knob: Knob, value: Knob['value']): Knob {
  return match(knob)
    .returnType<Knob>()
    .with({ type: 'number' }, (knob) =>
      typeof value === 'number' ? { ...knob, value } : knob
    )
    .with({ type: 'boolean' }, (knob) =>
      typeof value === 'boolean' ? { ...knob, value } : knob
    )
    .with({ type: 'text' }, { type: 'choice' }, { type: 'question' }, (knob) =>
      typeof value === 'string' ? { ...knob, value } : knob
    )
    .with({ type: 'entity' }, (knob) =>
      isEntityOf(knob, value) ? { ...knob, value } : knob
    )
    .exhaustive();
}
