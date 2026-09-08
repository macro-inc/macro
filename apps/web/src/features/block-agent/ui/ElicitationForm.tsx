/**
 * The fields of an elicitation form, props-in JSX-out. The caller owns the
 * draft values and validation (`state/elicitation-form.ts`) and the card
 * chrome; this renders one control per property and reports edits.
 */

import type {
  ElicitationProperty,
  ElicitationSchema,
} from '@service-agent-fold/generated/types';
import { Checkbox } from '@ui';
import { For, type JSX, Show } from 'solid-js';
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
  'w-full rounded-md border border-edge-muted bg-surface px-2 py-1 text-sm text-ink placeholder:text-ink-placeholder focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';

/** Bordered choice row matching settings `ChoiceRow`, tightened for chat. */
function ChoiceOption(props: {
  checked: boolean;
  disabled?: boolean;
  children: JSX.Element;
}) {
  return (
    <label
      class="flex min-w-0 items-start gap-2 rounded-md border px-2 py-1.5 text-sm text-ink transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30"
      classList={{
        'border-accent bg-accent-bg': props.checked,
        'border-edge-muted hover:bg-hover': !props.checked && !props.disabled,
        'border-edge-muted': !props.checked && !!props.disabled,
        'opacity-50': props.disabled,
      }}
    >
      {props.children}
    </label>
  );
}

/** Custom radio mark matching the calendar recurrence picker. */
function RadioMark(props: { checked: boolean }) {
  return (
    <span
      class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border bg-surface"
      classList={{
        'border-accent': props.checked,
        'border-edge-muted': !props.checked,
      }}
      aria-hidden="true"
    >
      <Show when={props.checked}>
        <span class="size-2 rounded-full bg-accent" />
      </Show>
    </span>
  );
}

function OptionCopy(props: { title: string; description?: string | null }) {
  return (
    <span class="flex min-w-0 flex-col">
      <span class="font-medium">{props.title}</span>
      <Show when={props.description}>
        {(description) => (
          <span class="text-xs font-normal text-ink-extra-muted">
            {description()}
          </span>
        )}
      </Show>
    </span>
  );
}

function Field(props: {
  property: ElicitationProperty;
  required: boolean;
  error?: string;
  children: unknown;
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
      {props.children as never}
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
        {(property) => {
          const value = () => props.values[property.name];
          const selection = (): SingleSelection => {
            const current = value();
            return current?.kind === 'single_select'
              ? current.selection
              : { kind: 'none' };
          };
          const field = property.schema;
          const set = (next: FieldValue) => props.onChange(property.name, next);
          return (
            <Field
              property={property}
              required={required(property.name)}
              error={props.errors[property.name]}
            >
              {field.type === 'string' && field.options.length > 0 ? (
                <div
                  class="flex flex-col gap-1.5"
                  role="radiogroup"
                  aria-label={property.title ?? property.name}
                >
                  <For each={field.options}>
                    {(option) => {
                      const checked = () => {
                        const current = selection();
                        return (
                          current.kind === 'option' &&
                          current.value === option.value
                        );
                      };
                      return (
                        <ChoiceOption
                          checked={checked()}
                          disabled={props.disabled}
                        >
                          <input
                            type="radio"
                            class="sr-only"
                            name={`elicitation-${property.name}`}
                            value={option.value}
                            checked={checked()}
                            disabled={props.disabled}
                            onChange={() =>
                              set({
                                kind: 'single_select',
                                selection: {
                                  kind: 'option',
                                  value: option.value,
                                },
                              })
                            }
                          />
                          <RadioMark checked={checked()} />
                          <OptionCopy
                            title={option.title ?? option.value}
                            description={option.description}
                          />
                        </ChoiceOption>
                      );
                    }}
                  </For>
                  <Show when={field.customField}>
                    <ChoiceOption
                      checked={selection().kind === 'custom'}
                      disabled={props.disabled}
                    >
                      <input
                        type="radio"
                        class="sr-only"
                        name={`elicitation-${property.name}`}
                        checked={selection().kind === 'custom'}
                        disabled={props.disabled}
                        onChange={() =>
                          set({
                            kind: 'single_select',
                            selection: { kind: 'custom', text: '' },
                          })
                        }
                      />
                      <RadioMark checked={selection().kind === 'custom'} />
                      <span class="flex min-w-0 flex-1 flex-col gap-1">
                        <span class="font-medium">Other</span>
                        <input
                          type="text"
                          class={INPUT_CLASS}
                          placeholder="Type your own answer"
                          disabled={props.disabled}
                          value={(() => {
                            const current = selection();
                            return current.kind === 'custom'
                              ? current.text
                              : '';
                          })()}
                          onInput={(event) =>
                            set({
                              kind: 'single_select',
                              selection: {
                                kind: 'custom',
                                text: event.currentTarget.value,
                              },
                            })
                          }
                        />
                      </span>
                    </ChoiceOption>
                  </Show>
                </div>
              ) : field.type === 'string' ? (
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
                  value={textOf(value())}
                  onInput={(event) =>
                    set({ kind: 'text', text: event.currentTarget.value })
                  }
                />
              ) : field.type === 'number' || field.type === 'integer' ? (
                <input
                  type="number"
                  class={INPUT_CLASS}
                  disabled={props.disabled}
                  step={field.type === 'integer' ? 1 : 'any'}
                  min={field.minimum ?? undefined}
                  max={field.maximum ?? undefined}
                  value={textOf(value())}
                  onInput={(event) =>
                    set({ kind: 'text', text: event.currentTarget.value })
                  }
                />
              ) : field.type === 'boolean' ? (
                <Checkbox
                  checked={(() => {
                    const current = value();
                    return current?.kind === 'boolean' && current.checked;
                  })()}
                  disabled={props.disabled}
                  onChange={(checked) => set({ kind: 'boolean', checked })}
                >
                  <Checkbox.Control />
                  <Checkbox.Label class="text-sm text-ink">Yes</Checkbox.Label>
                </Checkbox>
              ) : field.type === 'multi_select' ? (
                <div class="flex flex-col gap-1.5">
                  <For each={field.options}>
                    {(option) => {
                      const selected = () => {
                        const current = value();
                        return current?.kind === 'multi_select'
                          ? current.values
                          : [];
                      };
                      const checked = () => selected().includes(option.value);
                      return (
                        <Checkbox
                          class="w-full min-w-0 items-start rounded-md border px-2 py-1.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30"
                          classList={{
                            'border-accent bg-accent-bg': checked(),
                            'border-edge-muted hover:bg-hover':
                              !checked() && !props.disabled,
                            'border-edge-muted': !checked() && !!props.disabled,
                            'opacity-50': props.disabled,
                          }}
                          checked={checked()}
                          disabled={props.disabled}
                          onChange={(next) =>
                            set({
                              kind: 'multi_select',
                              values: next
                                ? [...selected(), option.value]
                                : selected().filter(
                                    (item) => item !== option.value
                                  ),
                              custom: undefined,
                            })
                          }
                        >
                          <Checkbox.Control class="mt-0.5" />
                          <Checkbox.Label class="min-w-0 text-sm text-ink">
                            <OptionCopy
                              title={option.title ?? option.value}
                              description={option.description}
                            />
                          </Checkbox.Label>
                        </Checkbox>
                      );
                    }}
                  </For>
                  <Show when={field.customField}>
                    <input
                      type="text"
                      class={INPUT_CLASS}
                      placeholder="Or type your own answer"
                      disabled={props.disabled}
                      value={(() => {
                        const current = value();
                        return current?.kind === 'multi_select'
                          ? (current.custom ?? '')
                          : '';
                      })()}
                      onInput={(event) =>
                        set({
                          kind: 'multi_select',
                          values: [],
                          custom: event.currentTarget.value,
                        })
                      }
                    />
                  </Show>
                </div>
              ) : (
                <div class="text-xs text-ink-extra-muted italic">
                  This client cannot display a {field.typeName} field.
                </div>
              )}
            </Field>
          );
        }}
      </For>
    </div>
  );
}
