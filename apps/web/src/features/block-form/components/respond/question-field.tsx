import Paperclip from '@phosphor/paperclip.svg';
import Spinner from '@phosphor/spinner.svg';
import UploadSimple from '@phosphor/upload-simple.svg';
import X from '@phosphor/x.svg';
import { Button, Checkbox, cn, RadioGroup } from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  dateInputFromInstant,
  instantFromDateInput,
  instantFromLocalInput,
  localInputFromInstant,
} from '../../core/date-answers';
import type {
  FormCellValue,
  FormColumn,
  FormEntityKind,
  FormQuestion,
  QuestionWidget,
} from '../../core/form-model';

/** The id of a question's input, so labels and errors point at it. */
/** A question's field id, scoped to one respond view so two never collide. */
export const fieldId = (scope: string, questionId: string) =>
  `${scope}-question-${questionId}`;

function optionIds(value: FormCellValue | undefined): string[] {
  if (value?.type !== 'options') return [];
  return value.value.flatMap((reference) =>
    'id' in reference ? [reference.id] : []
  );
}

function textOf(value: FormCellValue | undefined): string {
  return value?.type === 'text' ? value.value : '';
}

function ChoiceList(props: {
  name: string;
  column: FormColumn;
  multi: boolean;
  value: FormCellValue | undefined;
  invalid: boolean;
  disabled: boolean;
  describedBy: string | undefined;
  onChange: (value: FormCellValue | undefined) => void;
}) {
  const selected = () => optionIds(props.value);
  const toggle = (optionId: string, checked: boolean) => {
    const next = props.multi
      ? checked
        ? [...selected(), optionId]
        : selected().filter((id) => id !== optionId)
      : checked
        ? [optionId]
        : [];
    props.onChange(
      next.length
        ? { type: 'options', value: next.map((id) => ({ id })) }
        : undefined
    );
  };
  return (
    <div class="flex flex-col gap-1">
      <Show
        when={!props.multi}
        fallback={
          <div
            role="group"
            aria-labelledby={`${props.name}-label`}
            aria-describedby={props.describedBy}
            aria-invalid={props.invalid}
            class="flex flex-col gap-1"
          >
            <For each={props.column.options}>
              {(option) => (
                <Checkbox
                  name={props.name}
                  value={option.id}
                  checked={selected().includes(option.id)}
                  disabled={props.disabled}
                  validationState={props.invalid ? 'invalid' : 'valid'}
                  onChange={(checked) => toggle(option.id, checked)}
                  class="flex min-h-9 gap-3 rounded-lg px-2 text-sm text-ink hover:bg-hover"
                >
                  <Checkbox.Control class="border-ink-extra-muted" />
                  <Checkbox.Label class="flex min-h-9 flex-1 items-center wrap-anywhere">
                    {option.label}
                  </Checkbox.Label>
                </Checkbox>
              )}
            </For>
          </div>
        }
      >
        <RadioGroup
          name={props.name}
          value={selected()[0] ?? ''}
          onChange={(optionId) => toggle(optionId, true)}
          disabled={props.disabled}
          validationState={props.invalid ? 'invalid' : 'valid'}
          aria-labelledby={`${props.name}-label`}
          aria-describedby={props.describedBy}
          class="gap-1"
        >
          <For each={props.column.options}>
            {(option) => (
              <RadioGroup.Item
                value={option.id}
                class="min-h-9 gap-3 rounded-lg px-2 text-sm text-ink hover:bg-hover"
              >
                <RadioGroup.ItemControl class="border-ink-extra-muted" />
                <RadioGroup.ItemLabel class="flex min-h-9 flex-1 items-center wrap-anywhere">
                  {option.label}
                </RadioGroup.ItemLabel>
              </RadioGroup.Item>
            )}
          </For>
        </RadioGroup>
      </Show>
      <Show when={!props.multi && selected().length > 0}>
        <Button
          variant="ghost"
          size="xs"
          disabled={props.disabled}
          class="self-start"
          onClick={() => props.onChange(undefined)}
        >
          Clear selection
        </Button>
      </Show>
    </div>
  );
}

/** A file question: uploads on pick and stores the file's link. */
function FileField(props: {
  id: string;
  value: FormCellValue | undefined;
  invalid: boolean;
  disabled: boolean;
  describedBy: string | undefined;
  upload: (file: File) => Promise<string | undefined>;
  onChange: (value: FormCellValue | undefined) => void;
}) {
  const [uploading, setUploading] = createSignal(false);
  const [fileName, setFileName] = createSignal<string>();
  const link = () =>
    props.value?.type === 'link' ? props.value.value[0] : undefined;
  let input: HTMLInputElement | undefined;
  return (
    <div class="flex flex-col gap-2">
      <input
        ref={input}
        id={props.id}
        type="file"
        class="sr-only"
        disabled={props.disabled || uploading()}
        aria-describedby={props.describedBy}
        aria-invalid={props.invalid}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          setUploading(true);
          try {
            const uploaded = await props.upload(file);
            if (uploaded) {
              setFileName(file.name);
              props.onChange({ type: 'link', value: [uploaded] });
            }
          } finally {
            setUploading(false);
          }
        }}
      />
      <Show
        when={link()}
        fallback={
          <button
            type="button"
            disabled={props.disabled || uploading()}
            class={cn(
              'flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed px-4 text-sm text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus disabled:opacity-60',
              props.invalid ? 'border-failure' : 'border-edge'
            )}
            onClick={() => input?.click()}
          >
            <Show
              when={uploading()}
              fallback={<UploadSimple class="size-4" aria-hidden="true" />}
            >
              <Spinner class="size-4 animate-spin" aria-hidden="true" />
            </Show>
            {uploading() ? 'Uploading…' : 'Add file'}
          </button>
        }
      >
        {(url) => (
          <div class="flex items-center gap-2 rounded-lg border border-edge-muted bg-panel px-3 py-2 text-sm">
            <Paperclip
              class="size-4 shrink-0 text-ink-muted"
              aria-hidden="true"
            />
            <a
              href={url()}
              target="_blank"
              rel="noreferrer"
              class="min-w-0 flex-1 truncate text-link hover:underline"
            >
              {fileName() ?? 'Uploaded file'}
            </a>
            <Show when={!props.disabled}>
              <button
                type="button"
                aria-label="Remove file"
                class="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus"
                onClick={() => {
                  setFileName(undefined);
                  props.onChange(undefined);
                }}
              >
                <X class="size-3.5" />
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

/**
 * One question as a respondent answers it, by the widget its column is
 * asked with. People, documents and related rows use the app's pickers.
 */
export function QuestionField(props: {
  /** The respond view's own id prefix. */
  scope: string;
  question: FormQuestion;
  column: FormColumn;
  widget: QuestionWidget | null;
  number: number;
  value: FormCellValue | undefined;
  problem: string | undefined;
  disabled: boolean;
  compact: boolean;
  upload: (file: File) => Promise<string | undefined>;
  renderEntityPicker: (picker: {
    target: FormEntityKind;
    multi: boolean;
    invalid: boolean;
  }) => JSX.Element;
  renderRelationPicker: (picker: {
    databaseId: string;
    tableId: string;
    invalid: boolean;
  }) => JSX.Element;
  onChange: (value: FormCellValue | undefined) => void;
}) {
  const id = () => fieldId(props.scope, props.question.id);
  const helpId = () => `${id()}-help`;
  const errorId = () => `${id()}-error`;
  const describedBy = () =>
    [props.question.helpText ? helpId() : '', props.problem ? errorId() : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const invalid = () => !!props.problem;
  const kind = () => props.column.kind;
  const multiChoice = () => {
    const current = kind();
    return (
      current.type === 'tag' ||
      ((current.type === 'select' || current.type === 'select_number') &&
        current.multi)
    );
  };
  const entityKind = () => {
    const current = kind();
    return current.type === 'entity' ? current : undefined;
  };
  const relationKind = () => {
    const current = kind();
    return current.type === 'relation' ? current : undefined;
  };
  const [numberDraft, setNumberDraft] = createSignal<string>();
  return (
    <div
      class={cn(
        'flex flex-col gap-2 rounded-xl border bg-surface',
        props.compact ? 'px-3 py-3' : 'px-4 py-4 sm:px-5',
        invalid() ? 'border-failure' : 'border-edge'
      )}
      data-question-field={props.question.id}
    >
      <div class="flex flex-col gap-0.5">
        <label
          id={`${id()}-label`}
          for={kind().type === 'boolean' ? `${id()}-input` : id()}
          class="text-sm font-medium text-ink wrap-anywhere"
        >
          {props.column.name}
          <Show when={props.question.required}>
            <span class="ml-0.5 text-failure-ink" aria-hidden="true">
              *
            </span>
            <span class="sr-only"> (required)</span>
          </Show>
        </label>
        <Show when={props.question.helpText}>
          <p id={helpId()} class="text-xs text-ink-muted wrap-anywhere">
            {props.question.helpText}
          </p>
        </Show>
      </div>
      <Switch>
        <Match when={kind().type === 'text' && props.widget === 'paragraph'}>
          <textarea
            id={id()}
            rows={props.compact ? 2 : 4}
            value={textOf(props.value)}
            maxlength={10000}
            placeholder="Your answer"
            disabled={props.disabled}
            aria-describedby={describedBy()}
            aria-invalid={invalid()}
            aria-required={props.question.required}
            class={cn(
              'w-full rounded-md border bg-input px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus disabled:opacity-60',
              'resize-y py-2',
              invalid() ? 'border-failure' : 'border-edge-muted'
            )}
            onInput={(event) =>
              props.onChange(
                event.currentTarget.value
                  ? { type: 'text', value: event.currentTarget.value }
                  : undefined
              )
            }
          />
        </Match>
        <Match when={kind().type === 'text'}>
          <input
            id={id()}
            type="text"
            value={textOf(props.value)}
            maxlength={1000}
            placeholder="Your answer"
            disabled={props.disabled}
            aria-describedby={describedBy()}
            aria-invalid={invalid()}
            aria-required={props.question.required}
            class={cn(
              'w-full rounded-md border bg-input px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus disabled:opacity-60',
              'h-10',
              invalid() ? 'border-failure' : 'border-edge-muted'
            )}
            onInput={(event) =>
              props.onChange(
                event.currentTarget.value
                  ? { type: 'text', value: event.currentTarget.value }
                  : undefined
              )
            }
          />
        </Match>
        <Match when={kind().type === 'number'}>
          <input
            id={id()}
            type="number"
            inputmode="decimal"
            step="any"
            value={
              numberDraft() ??
              (props.value?.type === 'number' &&
              Number.isFinite(props.value.value)
                ? String(props.value.value)
                : '')
            }
            placeholder="Number"
            disabled={props.disabled}
            aria-describedby={describedBy()}
            aria-invalid={invalid()}
            aria-required={props.question.required}
            class={cn(
              'w-full rounded-md border bg-input px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus disabled:opacity-60',
              'h-10 max-w-60',
              invalid() ? 'border-failure' : 'border-edge-muted'
            )}
            onInput={(event) => {
              const text = event.currentTarget.value;
              setNumberDraft(text);
              if (!text) {
                props.onChange(undefined);
                return;
              }
              const number = event.currentTarget.valueAsNumber;
              props.onChange({ type: 'number', value: number });
            }}
          />
        </Match>
        <Match when={kind().type === 'boolean'}>
          <Checkbox
            id={id()}
            checked={props.value?.type === 'boolean' && props.value.value}
            disabled={props.disabled}
            validationState={invalid() ? 'invalid' : 'valid'}
            class="flex min-h-9 gap-3 rounded-lg px-2 text-sm text-ink hover:bg-hover"
            // Untouched stays unanswered; once touched, unchecked is an
            // explicit false, as the server and gates read it.
            onChange={(checked) =>
              props.onChange({ type: 'boolean', value: checked })
            }
          >
            <Checkbox.Control class="border-ink-extra-muted" />
            <Checkbox.Label class="flex min-h-9 flex-1 items-center">
              Yes
            </Checkbox.Label>
            <Checkbox.Description class="sr-only">
              {props.column.name}. {props.question.helpText} {props.problem}
            </Checkbox.Description>
          </Checkbox>
        </Match>
        <Match when={kind().type === 'date' && props.widget === 'date'}>
          <input
            id={id()}
            type="date"
            value={
              props.value?.type === 'date'
                ? dateInputFromInstant(props.value.value)
                : ''
            }
            disabled={props.disabled}
            aria-describedby={describedBy()}
            aria-invalid={invalid()}
            aria-required={props.question.required}
            class={cn(
              'w-full rounded-md border bg-input px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus disabled:opacity-60',
              'h-10 max-w-60',
              invalid() ? 'border-failure' : 'border-edge-muted'
            )}
            onChange={(event) => {
              const instant = instantFromDateInput(event.currentTarget.value);
              props.onChange(
                instant ? { type: 'date', value: instant } : undefined
              );
            }}
          />
        </Match>
        <Match when={kind().type === 'date'}>
          <input
            id={id()}
            type="datetime-local"
            value={
              props.value?.type === 'date'
                ? localInputFromInstant(props.value.value)
                : ''
            }
            disabled={props.disabled}
            aria-describedby={describedBy()}
            aria-invalid={invalid()}
            aria-required={props.question.required}
            class={cn(
              'w-full rounded-md border bg-input px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus disabled:opacity-60',
              'h-10 max-w-72',
              invalid() ? 'border-failure' : 'border-edge-muted'
            )}
            onChange={(event) => {
              const instant = instantFromLocalInput(event.currentTarget.value);
              props.onChange(
                instant ? { type: 'date', value: instant } : undefined
              );
            }}
          />
        </Match>
        <Match when={kind().type === 'link' && props.widget === 'file'}>
          <FileField
            id={id()}
            value={props.value}
            invalid={invalid()}
            disabled={props.disabled}
            describedBy={describedBy()}
            upload={props.upload}
            onChange={props.onChange}
          />
        </Match>
        <Match when={kind().type === 'link'}>
          <input
            id={id()}
            type="url"
            inputmode="url"
            placeholder="https://"
            value={
              props.value?.type === 'link' ? (props.value.value[0] ?? '') : ''
            }
            disabled={props.disabled}
            aria-describedby={describedBy()}
            aria-invalid={invalid()}
            aria-required={props.question.required}
            class={cn(
              'w-full rounded-md border bg-input px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus disabled:opacity-60',
              'h-10',
              invalid() ? 'border-failure' : 'border-edge-muted'
            )}
            onInput={(event) => {
              const url = event.currentTarget.value.trim();
              props.onChange(url ? { type: 'link', value: [url] } : undefined);
            }}
          />
        </Match>
        <Match
          when={
            (kind().type === 'select' || kind().type === 'select_number') &&
            props.widget === 'dropdown'
          }
        >
          <select
            id={id()}
            disabled={props.disabled}
            aria-describedby={describedBy()}
            aria-invalid={invalid()}
            aria-required={props.question.required}
            class={cn(
              'w-full rounded-md border bg-input px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-edge-focus disabled:opacity-60',
              'h-10 max-w-sm',
              invalid() ? 'border-failure' : 'border-edge-muted'
            )}
            onChange={(event) => {
              const optionId = event.currentTarget.value;
              props.onChange(
                optionId
                  ? { type: 'options', value: [{ id: optionId }] }
                  : undefined
              );
            }}
          >
            <option value="" selected={optionIds(props.value).length === 0}>
              Choose
            </option>
            <For each={props.column.options}>
              {(option) => (
                <option
                  value={option.id}
                  selected={optionIds(props.value).includes(option.id)}
                >
                  {option.label}
                </option>
              )}
            </For>
          </select>
        </Match>
        <Match
          when={
            kind().type === 'select' ||
            kind().type === 'select_number' ||
            kind().type === 'tag'
          }
        >
          <ChoiceList
            name={id()}
            column={props.column}
            multi={multiChoice()}
            value={props.value}
            invalid={invalid()}
            disabled={props.disabled}
            describedBy={describedBy()}
            onChange={props.onChange}
          />
        </Match>
        <Match when={entityKind()}>
          {(entity) =>
            props.renderEntityPicker({
              target: entity().target,
              multi: entity().multi,
              invalid: invalid(),
            })
          }
        </Match>
        <Match when={relationKind()}>
          {(relation) =>
            props.renderRelationPicker({
              databaseId: relation().database,
              tableId: relation().table,
              invalid: invalid(),
            })
          }
        </Match>
      </Switch>
      <Show when={props.problem}>
        <p id={errorId()} role="alert" class="text-xs text-failure-ink">
          {props.problem}
        </p>
      </Show>
    </div>
  );
}
