/**
 * The fields of an elicitation form, props-in JSX-out. The caller owns the
 * draft values and validation (`state/elicitation-form.ts`) and the card
 * chrome; this renders one control per property and reports edits.
 *
 * Choices are rows in the app's menu idiom - a box that fills accent when
 * chosen, round for one answer and square for several - rather than the
 * browser's radio and checkbox glyphs, so a question reads like the rest of
 * the session. The rows keep their ARIA roles (`radio`, `checkbox`); a radio
 * group keeps one tab stop and moves its choice with the arrow keys, as the
 * native control does.
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

/** A typed answer: free text, or a number while it is being typed. */
function TextInput(props: {
  type: 'text' | 'email' | 'url' | 'number';
  value: string;
  disabled?: boolean;
  step?: number | 'any';
  min?: number;
  max?: number;
  onInput: (text: string) => void;
}) {
  return (
    <input
      type={props.type}
      class="h-8 w-full rounded-md border border-edge-muted bg-transparent px-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-placeholder hover:border-edge focus:border-accent disabled:opacity-50"
      disabled={props.disabled}
      step={props.step}
      min={props.min}
      max={props.max}
      value={props.value}
      onInput={(event) => props.onInput(event.currentTarget.value)}
    />
  );
}

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
  /** A radio group's one tab stop is its chosen (or first) row. */
  tabIndex?: number;
  onSelect: () => void;
  option: ElicitationOption;
}) {
  return (
    <button
      type="button"
      role={props.role}
      aria-checked={props.checked}
      tabIndex={props.tabIndex}
      class="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink outline-none not-disabled:hover:bg-ink/5 focus-visible:bg-ink/5 disabled:opacity-50"
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
  tabIndex?: number;
  text: string;
  onSelect: () => void;
  onInput: (text: string) => void;
}) {
  return (
    <div
      class="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink outline-none"
      classList={{
        'hover:bg-ink/5': !props.disabled,
        'opacity-50': props.disabled,
      }}
    >
      <button
        type="button"
        role={props.role}
        aria-checked={props.checked}
        aria-label="Other"
        tabIndex={props.tabIndex}
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

/**
 * One answer from several, with the keyboard behavior of a native radio
 * group: one tab stop (the chosen row, or the first), and the arrow keys
 * move the choice - onto the Other row too, when there is one.
 */
function SingleChoice(props: {
  field: SingleSelect;
  value: FieldValue | undefined;
  disabled?: boolean;
  labelId: string;
  onChange: (next: FieldValue) => void;
}) {
  let group: HTMLDivElement | undefined;
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
  // The rows in order, Other last; the tab stop is the chosen one, else the
  // first.
  const rowCount = () =>
    props.field.options.length + (props.field.customField ? 1 : 0);
  const chosenIndex = () => {
    const current = selection();
    if (current.kind === 'option') {
      const index = props.field.options.findIndex(
        (option) => option.value === current.value
      );
      return index === -1 ? 0 : index;
    }
    return current.kind === 'custom' ? props.field.options.length : 0;
  };
  const tabIndex = (index: number) => (index === chosenIndex() ? 0 : -1);
  const choose = (index: number) => {
    const option = props.field.options[index];
    if (option) pick({ kind: 'option', value: option.value });
    else if (selection().kind !== 'custom') pick({ kind: 'custom', text: '' });
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (props.disabled) return;
    // Arrows inside the Other text box edit it; only a row moves the choice.
    if (
      !(event.target instanceof Element) ||
      event.target.getAttribute('role') !== 'radio'
    )
      return;
    const step = match(event.key)
      .with('ArrowDown', 'ArrowRight', () => 1)
      .with('ArrowUp', 'ArrowLeft', () => -1)
      .otherwise(() => 0);
    if (step === 0) return;
    event.preventDefault();
    choose((chosenIndex() + step + rowCount()) % rowCount());
  };

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-labelledby={props.labelId}
      class="flex flex-col"
      onKeyDown={onKeyDown}
    >
      <For each={props.field.options}>
        {(option, index) => (
          <ChoiceRow
            role="radio"
            option={option}
            checked={chosen(option)}
            disabled={props.disabled}
            tabIndex={tabIndex(index())}
            onSelect={() => pick({ kind: 'option', value: option.value })}
          />
        )}
      </For>
      <Show when={props.field.customField}>
        <OtherRow
          role="radio"
          checked={selection().kind === 'custom'}
          disabled={props.disabled}
          tabIndex={tabIndex(props.field.options.length)}
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
  labelId: string;
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
    <div role="group" aria-labelledby={props.labelId} class="flex flex-col">
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
  /** The id of the field's title, for the groups' `aria-labelledby`. */
  labelId: string;
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
              labelId={props.labelId}
              onChange={props.onChange}
            />
          )
        )
        .with({ type: 'string' }, (field) => (
          <TextInput
            type={
              field.format === 'email'
                ? 'email'
                : field.format === 'uri'
                  ? 'url'
                  : 'text'
            }
            disabled={props.disabled}
            value={textOf(props.value)}
            onInput={(text) => props.onChange({ kind: 'text', text })}
          />
        ))
        .with({ type: 'number' }, { type: 'integer' }, (field) => (
          <TextInput
            type="number"
            disabled={props.disabled}
            step={field.type === 'integer' ? 1 : 'any'}
            min={field.minimum ?? undefined}
            max={field.maximum ?? undefined}
            value={textOf(props.value)}
            onInput={(text) => props.onChange({ kind: 'text', text })}
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
            labelId={props.labelId}
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

/** The id of a field's title, which its group of choices is labelled by. */
function labelIdOf(property: ElicitationProperty) {
  return `elicitation-${property.name}-label`;
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
        <span id={labelIdOf(props.property)}>
          {props.property.title ?? props.property.name}
        </span>
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
              labelId={labelIdOf(property)}
              onChange={(next) => props.onChange(property.name, next)}
            />
          </Field>
        )}
      </For>
    </div>
  );
}
