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
import { For, Show } from 'solid-js';
import type { FieldValue, FormValues } from '../state/elicitation-form';

export interface ElicitationFormProps {
  schema: ElicitationSchema;
  values: FormValues;
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (name: string, value: FieldValue) => void;
}

const INPUT_CLASS =
  'w-full rounded-md border border-edge-muted bg-surface px-2 py-1 text-sm text-ink placeholder:text-ink-placeholder focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';

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
          const field = property.schema;
          const set = (next: FieldValue) => props.onChange(property.name, next);
          return (
            <Field
              property={property}
              required={required(property.name)}
              error={props.errors[property.name]}
            >
              {field.type === 'string' && field.options.length > 0 ? (
                <div class="flex flex-col gap-1" role="radiogroup">
                  <For each={field.options}>
                    {(option) => {
                      const current = value();
                      const checked = () =>
                        current?.kind === 'choice' &&
                        current.value === option.value;
                      return (
                        <label class="flex items-start gap-2 text-sm text-ink">
                          <input
                            type="radio"
                            class="mt-1 accent-accent"
                            name={`elicitation-${property.name}`}
                            value={option.value}
                            checked={checked()}
                            disabled={props.disabled}
                            onChange={() =>
                              set({
                                kind: 'choice',
                                value: option.value,
                                custom: '',
                              })
                            }
                          />
                          <span class="flex flex-col">
                            <span>{option.title ?? option.value}</span>
                            <Show when={option.description}>
                              {(description) => (
                                <span class="text-xs text-ink-extra-muted">
                                  {description()}
                                </span>
                              )}
                            </Show>
                          </span>
                        </label>
                      );
                    }}
                  </For>
                  <Show when={field.customField}>
                    <label class="flex items-start gap-2 text-sm text-ink">
                      <input
                        type="radio"
                        class="mt-1 accent-accent"
                        name={`elicitation-${property.name}`}
                        value="__custom"
                        checked={(() => {
                          const current = value();
                          return (
                            current?.kind === 'choice' &&
                            current.value === undefined &&
                            current.custom.length > 0
                          );
                        })()}
                        disabled={props.disabled}
                        onChange={() =>
                          set({ kind: 'choice', value: undefined, custom: ' ' })
                        }
                      />
                      <span class="flex min-w-0 flex-1 flex-col gap-1">
                        <span>Other</span>
                        <input
                          type="text"
                          class={INPUT_CLASS}
                          placeholder="Type your own answer"
                          disabled={props.disabled}
                          value={(() => {
                            const current = value();
                            return current?.kind === 'choice'
                              ? current.custom.trimStart()
                              : '';
                          })()}
                          onInput={(event) =>
                            set({
                              kind: 'choice',
                              value: undefined,
                              custom: event.currentTarget.value,
                            })
                          }
                        />
                      </span>
                    </label>
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
                  value={
                    value()?.kind === 'text'
                      ? (value() as { text: string }).text
                      : ''
                  }
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
                  value={
                    value()?.kind === 'number'
                      ? (value() as { text: string }).text
                      : ''
                  }
                  onInput={(event) =>
                    set({ kind: 'number', text: event.currentTarget.value })
                  }
                />
              ) : field.type === 'boolean' ? (
                <Checkbox
                  checked={
                    value()?.kind === 'boolean' &&
                    (value() as { checked: boolean }).checked
                  }
                  disabled={props.disabled}
                  onChange={(checked) => set({ kind: 'boolean', checked })}
                >
                  <Checkbox.Control />
                  <Checkbox.Label class="text-sm text-ink">Yes</Checkbox.Label>
                </Checkbox>
              ) : field.type === 'multi_select' ? (
                <div class="flex flex-col gap-1">
                  <For each={field.options}>
                    {(option) => {
                      const selected = () => {
                        const current = value();
                        return current?.kind === 'multi' ? current.values : [];
                      };
                      return (
                        <Checkbox
                          checked={selected().includes(option.value)}
                          disabled={props.disabled}
                          onChange={(checked) =>
                            set({
                              kind: 'multi',
                              values: checked
                                ? [...selected(), option.value]
                                : selected().filter(
                                    (item) => item !== option.value
                                  ),
                              custom: '',
                            })
                          }
                        >
                          <Checkbox.Control />
                          <Checkbox.Label class="flex flex-col text-sm text-ink">
                            <span>{option.title ?? option.value}</span>
                            <Show when={option.description}>
                              {(description) => (
                                <span class="text-xs text-ink-extra-muted">
                                  {description()}
                                </span>
                              )}
                            </Show>
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
                        return current?.kind === 'multi' ? current.custom : '';
                      })()}
                      onInput={(event) =>
                        set({
                          kind: 'multi',
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
