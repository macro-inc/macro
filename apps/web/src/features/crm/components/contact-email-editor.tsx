import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { useSearchInputFocus } from '@property/utils';
import { Button, Input } from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { ContactEmailChange } from '../core/contact';
import { ContactEmailRow } from './contact-email-row';

export type ChangeContactEmail = (
  email: string,
  change: ContactEmailChange
) => Promise<void>;

const keepTouchFocus = (event: Event) => {
  if (isTouchDevice()) event.preventDefault();
};

export type ContactEmailRequest = ReturnType<typeof createContactEmailChange>;

/** One pending address change at a time, with the rejection kept beside it. */
export function createContactEmailChange(
  change: ChangeContactEmail,
  message: (error: unknown, change: ContactEmailChange) => string
) {
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let active = true;
  onCleanup(() => {
    active = false;
  });

  return {
    saving,
    error,
    clearError: () => setError(undefined),
    /** Resolves to whether the server committed the change. */
    async run(email: string, kind: ContactEmailChange) {
      if (saving()) return false;
      setSaving(true);
      setError(undefined);
      try {
        await change(email, kind);
        return true;
      } catch (cause) {
        if (active) setError(message(cause, kind));
        return false;
      } finally {
        if (active) setSaving(false);
      }
    },
  };
}

/**
 * Every address with its actions, under a field that adds another. The field
 * stays for the next address while the contact can take one; once it can't
 * (a server without the address list), the editor closes after the add.
 */
export function ContactEmailEditor(props: {
  emails: string[];
  primary: string | null | undefined;
  manageable: boolean;
  companyEmail: string | undefined;
  /** Owned by the editor's host, which keeps it open while a change saves. */
  request: ContactEmailRequest;
  onClose(): void;
}) {
  const [draft, setDraft] = createSignal('');
  const request = props.request;
  const [input, setInput] = createSignal<HTMLInputElement>();
  useSearchInputFocus(input, () => !isTouchDevice());
  const canAdd = () => props.manageable || props.emails.length === 0;
  const focusField = () => {
    if (!isTouchDevice()) input()?.focus();
  };

  const add = async () => {
    if (!(await request.run(draft().trim(), 'add'))) return;
    setDraft('');
    if (canAdd()) focusField();
    else props.onClose();
  };
  const run = async (email: string, kind: 'remove' | 'primary') => {
    if (await request.run(email, kind)) focusField();
  };

  return (
    <div
      class="flex w-full min-w-0 flex-col"
      // The hosting menu would otherwise send Tab to its last control.
      on:keydown={(event) => {
        if (event.key === 'Tab') event.stopPropagation();
      }}
    >
      <Show when={canAdd()}>
        <form
          class="flex min-w-0 items-center gap-2 border-b border-edge-muted p-2"
          aria-label={t('crm.addEmail')}
          onSubmit={(event) => {
            event.preventDefault();
            fireAndForget(add(), 'crm');
          }}
        >
          <Input
            ref={setInput}
            type="email"
            size="sm"
            required
            aria-label={t('crm.email')}
            placeholder={t('crm.addEmailPlaceholder')}
            value={draft()}
            readOnly={request.saving()}
            autocomplete="off"
            spellcheck={false}
            data-1p-ignore
            class="ph-no-capture min-w-0 flex-1"
            onInput={(event) => {
              setDraft(event.currentTarget.value);
              request.clearError();
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            type="submit"
            disabled={request.saving()}
            // On touch the field keeps focus, so the keyboard stays up for
            // the next address.
            onPointerDown={keepTouchFocus}
            onMouseDown={keepTouchFocus}
          >
            {request.saving() ? t('crm.savingContact') : t('common.add')}
          </Button>
        </form>
      </Show>
      <Show when={props.emails.length > 0}>
        <ul
          class="flex min-w-0 flex-col gap-0.5 p-1"
          aria-label={t('crm.email')}
        >
          <For each={props.emails}>
            {(email) => (
              <li class="min-w-0">
                <ContactEmailRow
                  size="editor"
                  email={email}
                  primary={email === props.primary}
                  linksCompany={email === props.companyEmail}
                  manageable={props.manageable}
                  busy={request.saving()}
                  onMakePrimary={() =>
                    fireAndForget(run(email, 'primary'), 'crm')
                  }
                  onRemove={() => fireAndForget(run(email, 'remove'), 'crm')}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={request.error()}>
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
