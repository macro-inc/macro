import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { useSearchInputFocus } from '@property/utils';
import { Button, cn, Input } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';

const keepTouchFocus = (event: Event) => {
  if (isTouchDevice()) event.preventDefault();
};

/** The add field of a record's listed values. */
export type RecordValueField = {
  /** The field's name, and the add form's name. */
  label: string;
  formLabel: string;
  placeholder: string;
  type: 'email' | 'text';
  inputMode?: 'url';
  /** What adding a value does, under the field. */
  help?: string;
  /** Keeps a person's address out of session capture. */
  private?: boolean;
};

/**
 * Every value of a record with its actions, under a field that adds another.
 * The field stays for the next value while the record can take one; once it
 * can't, the editor closes after the add.
 */
export function RecordValueEditor(props: {
  values: string[];
  canAdd: boolean;
  field: RecordValueField;
  listLabel: string;
  saving: boolean;
  error: string | undefined;
  clearError(): void;
  /** Resolves to whether the server committed the value. */
  add(value: string): Promise<boolean>;
  /** One row; `refocus` puts focus back in the field after its action. */
  row(value: string, refocus: () => void): JSX.Element;
  onClose(): void;
}) {
  const [draft, setDraft] = createSignal('');
  const [input, setInput] = createSignal<HTMLInputElement>();
  useSearchInputFocus(input, () => !isTouchDevice());
  const focusField = () => {
    if (!isTouchDevice()) input()?.focus();
  };

  const add = async () => {
    if (!(await props.add(draft().trim()))) return;
    setDraft('');
    if (props.canAdd) focusField();
    else props.onClose();
  };

  return (
    <div
      class="flex w-full min-w-0 flex-col"
      // The hosting menu would otherwise send Tab to its last control.
      on:keydown={(event) => {
        if (event.key === 'Tab') event.stopPropagation();
      }}
    >
      <Show when={props.canAdd}>
        <div class="flex min-w-0 flex-col gap-1.5 border-b border-edge-muted p-2">
          <form
            class="flex min-w-0 items-center gap-2"
            aria-label={props.field.formLabel}
            onSubmit={(event) => {
              event.preventDefault();
              fireAndForget(add(), 'crm');
            }}
          >
            <Input
              ref={setInput}
              type={props.field.type}
              inputMode={props.field.inputMode}
              size="sm"
              required
              aria-label={props.field.label}
              placeholder={props.field.placeholder}
              value={draft()}
              readOnly={props.saving}
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              data-1p-ignore
              class={cn(
                'min-w-0 flex-1',
                props.field.private && 'ph-no-capture'
              )}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                props.clearError();
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              type="submit"
              disabled={props.saving}
              // On touch the field keeps focus, so the keyboard stays up for
              // the next value.
              onPointerDown={keepTouchFocus}
              onMouseDown={keepTouchFocus}
            >
              {props.saving ? t('crm.savingContact') : t('common.add')}
            </Button>
          </form>
          <Show when={props.field.help}>
            {(help) => <p class="px-1 text-xs text-ink-muted">{help()}</p>}
          </Show>
        </div>
      </Show>
      <Show when={props.values.length > 0}>
        {/* The rows scroll under the field; the popover's own height cap
            doesn't reach this list through its wrappers. */}
        <ul
          class="flex max-h-72 min-w-0 flex-col gap-0.5 overflow-y-auto p-1"
          aria-label={props.listLabel}
        >
          <For each={props.values}>
            {(value) => <li class="min-w-0">{props.row(value, focusField)}</li>}
          </For>
        </ul>
      </Show>
      <Show when={props.error}>
        {(message) => (
          <p
            role="alert"
            class="border-t border-edge-muted px-3 py-2 text-sm text-failure"
          >
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}
