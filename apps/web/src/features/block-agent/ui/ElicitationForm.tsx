/**
 * The fields of an elicitation form, props-in JSX-out. The caller owns the
 * draft values and validation (`state/elicitation-form.ts`) and the card
 * chrome; this renders one control per property and reports edits.
 *
 * Choices are rows in the app's menu idiom - a box that fills accent when
 * chosen, round for one answer and square for several - rather than the
 * browser's radio and checkbox glyphs, so a question reads like the rest of
 * the session. The rows keep their ARIA roles (`radio`, `checkbox`) so the
 * form is navigable the way the native controls were.
 */

import CheckIcon from '@phosphor/check.svg';
import type {
  ElicitationOption,
  ElicitationProperty,
  ElicitationPropertySchema,
  ElicitationSchema,
} from '@service-agent-fold/generated/types';
import { cn } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { match, P } from 'ts-pattern';
import type {
  FieldValue,
  FormValues,
  SingleSelection,
} from '../state/elicitation-form';

export interface ElicitationFormProps {
  schema: ElicitationSchema;
  values: FormValues;
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (name: string, value: FieldValue) => void;
}

/** The text a free-text or number field is showing. */
function textOf(value: FieldValue | undefined): string {
  return value?.kind === 'text' ? value.text : '';
}

const INPUT_CLASS =
  'h-8 w-full rounded-md border border-edge-muted bg-transparent px-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-placeholder hover:border-edge focus:border-accent disabled:opacity-50';

const ROW_CLASS =
  'group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink outline-none';

const ROW_INTERACTIVE_CLASS =
  'not-disabled:hover:bg-ink/5 focus-visible:bg-ink/5 disabled:opacity-50';

type SingleSelect = Extract<ElicitationPropertySchema, { type: 'string' }>;
type MultiSelect = Extract<ElicitationPropertySchema, { type: 'multi_select' }>;
type MultiSelectValue = Extract<FieldValue, { kind: 'multi_select' }>;

/** The box beside a choice: round for one answer, square for several. */
function ChoiceBox(props: { checked: boolean; multiple: boolean }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center border text-surface transition-colors',
        props.multiple ? 'rounded-sm' : 'rounded-full',
        props.checked
          ? 'border-accent bg-accent'
          : 'border-edge-muted bg-transparent group-hover:border-edge'
      )}
    >
      <CheckIcon class={cn('size-2.5', !props.checked && 'hidden')} />
    </span>
  );
}

function OptionText(props: { option: ElicitationOption }) {
  return (
    <span class="flex min-w-0 flex-col">
      <span>{props.option.title ?? props.option.value}</span>
      <Show when={props.option.description}>
        {(description) => (
          <span class="text-xs text-ink-extra-muted">{description()}</span>
        )}
      </Show>
    </span>
  );
}

function ChoiceRow(props: {
  role: 'radio' | 'checkbox';
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  option: ElicitationOption;
}) {
  return (
    <button
      type="button"
      role={props.role}
      aria-checked={props.checked}
      class={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS)}
      disabled={props.disabled}
      onClick={props.onSelect}
    >
      <ChoiceBox checked={props.checked} multiple={props.role === 'checkbox'} />
      <OptionText option={props.option} />
    </button>
  );
}

/**
 * The free-text escape a select may offer: its box selects it like any other
 * choice, and typing selects it too.
 */
function OtherRow(props: {
  role: 'radio' | 'checkbox';
  checked: boolean;
  disabled?: boolean;
  text: string;
  onSelect: () => void;
  onInput: (text: string) => void;
}) {
  return (
    <div
      class={cn(ROW_CLASS, 'items-center', props.disabled && 'opacity-50')}
      classList={{ 'hover:bg-ink/5': !props.disabled }}
    >
      <button
        type="button"
        role={props.role}
        aria-checked={props.checked}
        aria-label="Other"
        class="flex items-center outline-none"
        disabled={props.disabled}
        onClick={props.onSelect}
      >
        <ChoiceBox
          checked={props.checked}
          multiple={props.role === 'checkbox'}
        />
      </button>
      <input
        type="text"
        class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
        placeholder="Type your own answer"
        disabled={props.disabled}
        value={props.text}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </div>
  );
}

function SingleChoice(props: {
  field: SingleSelect;
  value: FieldValue | undefined;
  disabled?: boolean;
  onChange: (next: FieldValue) => void;
}) {
  const selection = (): SingleSelection =>
    props.value?.kind === 'single_select'
      ? props.value.selection
      : { kind: 'none' };
  const pick = (selection: SingleSelection) =>
    props.onChange({ kind: 'single_select', selection });
  const chosen = (option: ElicitationOption) => {
    const current = selection();
    return current.kind === 'option' && current.value === option.value;
  };
  const customText = () => {
    const current = selection();
    return current.kind === 'custom' ? current.text : '';
  };

  return (
    <div role="radiogroup" class="flex flex-col">
      <For each={props.field.options}>
        {(option) => (
          <ChoiceRow
            role="radio"
            option={option}
            checked={chosen(option)}
            disabled={props.disabled}
            onSelect={() => pick({ kind: 'option', value: option.value })}
          />
        )}
      </For>
      <Show when={props.field.customField}>
        <OtherRow
          role="radio"
          checked={selection().kind === 'custom'}
          disabled={props.disabled}
          text={customText()}
          onSelect={() => {
            if (selection().kind !== 'custom')
              pick({ kind: 'custom', text: '' });
          }}
          onInput={(text) => pick({ kind: 'custom', text })}
        />
      </Show>
    </div>
  );
}

function MultiChoice(props: {
  field: MultiSelect;
  value: FieldValue | undefined;
  disabled?: boolean;
  onChange: (next: FieldValue) => void;
}) {
  const current = (): MultiSelectValue =>
    props.value?.kind === 'multi_select'
      ? props.value
      : { kind: 'multi_select', values: [], custom: undefined };
  // A custom answer and chosen options never travel together, so picking one
  // side clears the other.
  const toggle = (option: ElicitationOption) => {
    const { values } = current();
    props.onChange({
      kind: 'multi_select',
      values: values.includes(option.value)
        ? values.filter((item) => item !== option.value)
        : [...values, option.value],
      custom: undefined,
    });
  };
  const custom = () => current().custom;

  return (
    <div role="group" class="flex flex-col">
      <For each={props.field.options}>
        {(option) => (
          <ChoiceRow
            role="checkbox"
            option={option}
            checked={current().values.includes(option.value)}
            disabled={props.disabled}
            onSelect={() => toggle(option)}
          />
        )}
      </For>
      <Show when={props.field.customField}>
        <OtherRow
          role="checkbox"
          checked={custom() !== undefined}
          disabled={props.disabled}
          text={custom() ?? ''}
          onSelect={() =>
            props.onChange({
              kind: 'multi_select',
              values: [],
              custom: custom() === undefined ? '' : undefined,
            })
          }
          onInput={(text) =>
            props.onChange({ kind: 'multi_select', values: [], custom: text })
          }
        />
      </Show>
    </div>
  );
}

const YES: ElicitationOption = {
  value: 'true',
  title: 'Yes',
  description: null,
};

function FieldControl(props: {
  field: ElicitationPropertySchema;
  value: FieldValue | undefined;
  disabled?: boolean;
  onChange: (next: FieldValue) => void;
}): JSX.Element {
  return (
    <>
      {match(props.field)
        .with(
          { type: 'string', options: P.when((options) => options.length > 0) },
          (field) => (
            <SingleChoice
              field={field}
              value={props.value}
              disabled={props.disabled}
              onChange={props.onChange}
            />
          )
        )
        .with({ type: 'string' }, (field) => (
          <input
            type={
              field.format === 'email'
                ? 'email'
                : field.format === 'uri'
                  ? 'url'
                  : 'text'
            }
            class={INPUT_CLASS}
            disabled={props.disabled}
            value={textOf(props.value)}
            onInput={(event) =>
              props.onChange({ kind: 'text', text: event.currentTarget.value })
            }
          />
        ))
        .with({ type: 'number' }, { type: 'integer' }, (field) => (
          <input
            type="number"
            class={INPUT_CLASS}
            disabled={props.disabled}
            step={field.type === 'integer' ? 1 : 'any'}
            min={field.minimum ?? undefined}
            max={field.maximum ?? undefined}
            value={textOf(props.value)}
            onInput={(event) =>
              props.onChange({ kind: 'text', text: event.currentTarget.value })
            }
          />
        ))
        .with({ type: 'boolean' }, () => {
          const checked = () =>
            props.value?.kind === 'boolean' && props.value.checked;
          return (
            <ChoiceRow
              role="checkbox"
              option={YES}
              checked={checked()}
              disabled={props.disabled}
              onSelect={() =>
                props.onChange({ kind: 'boolean', checked: !checked() })
              }
            />
          );
        })
        .with({ type: 'multi_select' }, (field) => (
          <MultiChoice
            field={field}
            value={props.value}
            disabled={props.disabled}
            onChange={props.onChange}
          />
        ))
        .with({ type: 'unrecognized' }, (field) => (
          <div class="text-xs text-ink-extra-muted italic">
            This client cannot display a {field.typeName} field.
          </div>
        ))
        .exhaustive()}
    </>
  );
}

function Field(props: {
  property: ElicitationProperty;
  required: boolean;
  error?: string;
  children: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-baseline gap-1 text-xs text-ink-muted">
        <span>{props.property.title ?? props.property.name}</span>
        <Show when={props.required}>
          <span aria-hidden="true" class="text-failure">
            *
          </span>
        </Show>
      </div>
      <Show when={props.property.description}>
        {(description) => (
          <div class="text-xs text-ink-extra-muted">{description()}</div>
        )}
      </Show>
      {props.children}
      <Show when={props.error}>
        {(error) => <div class="text-xs text-failure">{error()}</div>}
      </Show>
    </div>
  );
}

export function ElicitationForm(props: ElicitationFormProps) {
  const required = (name: string) => props.schema.required.includes(name);

  return (
    <div class="flex flex-col gap-3 py-1">
      <Show when={props.schema.description}>
        {(description) => (
          <div class="text-xs text-ink-muted">{description()}</div>
        )}
      </Show>
      <For each={props.schema.properties}>
        {(property) => (
          <Field
            property={property}
            required={required(property.name)}
            error={props.errors[property.name]}
          >
            <FieldControl
              field={property.schema}
              value={props.values[property.name]}
              disabled={props.disabled}
              onChange={(next) => props.onChange(property.name, next)}
            />
          </Field>
        )}
      </For>
    </div>
  );
}
