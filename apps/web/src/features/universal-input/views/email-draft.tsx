import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { fireAndForget } from '@core/util/fireAndForget';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { ComposeFieldRow } from '../../email-compose/components/compose-field-row';
import { ComposeRecipientInput } from '../../email-compose/components/compose-recipient-input';
import { ComposeSubjectField } from '../../email-compose/components/compose-subject-field';
import { FromInboxSelector } from '../../email-compose/components/from-inbox-selector';
import { fromInboxOptions } from '../../email-compose/core/email-sender';
import type { InputDisplay } from '../context/capabilities';
import type { UniversalInputController } from '../primitives/universal-input';
import {
  composerRecipientOptions,
  composerRecipients,
  recipientAddresses,
} from '../queries/composer-recipients';

/** Email's actual controls, with draft ownership and inference supplied by the session. */
export function EmailDraft(props: {
  state: UniversalInputController;
  actions: InputDisplay;
}) {
  const s = props.state;
  const a = props.actions;
  const options = createMemo(() => composerRecipientOptions(a.people()));
  const [showCopies, setShowCopies] = createSignal(false);
  const recipientFields = [
    { key: 'recipients', label: 'To' },
    { key: 'cc', label: 'Cc' },
    { key: 'bcc', label: 'Bcc' },
  ] as const;
  onCleanup(() => a.captureEmailEditor?.(undefined));
  return (
    <div>
      <ComposeFieldRow label="From">
        <FromInboxSelector
          pill
          class="w-fit max-w-full"
          links={fromInboxOptions(a.inboxes()).filter(
            (inbox) => !inbox.isAlias
          )}
          activeInboxId={a.selectedInbox(s.fields())?.id}
          onSelect={(id) => s.edit('inboxId', id)}
          disabled={s.sending()}
        />
      </ComposeFieldRow>
      <For each={recipientFields}>
        {(field) => {
          const value = createMemo(() => s.fields()[field.key]);
          const selected = createMemo(() =>
            composerRecipients(value(), a.people())
          );
          return (
            <Show
              when={
                field.key === 'recipients' ||
                showCopies() ||
                value() ||
                s.draft().edited.email.includes(field.key)
              }
            >
              <ComposeFieldRow
                label={field.label}
                trailing={
                  field.key === 'recipients' && !showCopies() ? (
                    <button
                      type="button"
                      class="text-xs text-ink-muted hover:text-ink"
                      onClick={() => setShowCopies(true)}
                    >
                      Cc/Bcc
                    </button>
                  ) : undefined
                }
              >
                <ComposeRecipientInput
                  options={options}
                  selectedOptions={selected()}
                  onInputChange={(value) => {
                    if (value && !s.draft().edited.email.includes(field.key))
                      s.edit(field.key, s.fields()[field.key]);
                  }}
                  setSelectedOptions={(next) =>
                    s.edit(field.key, recipientAddresses(next))
                  }
                  inputRef={(element) =>
                    element.setAttribute('aria-label', field.label)
                  }
                  focusOnMount={false}
                  disabled={s.sending()}
                  includeSelf
                  placeholder="Macro users or email addresses"
                />
              </ComposeFieldRow>
            </Show>
          );
        }}
      </For>
      <ComposeSubjectField
        value={s.fields().subject}
        onChange={(value) => s.edit('subject', value)}
        disabled={s.sending()}
      />
      <div class="py-4">
        <MarkdownTextarea
          value={s.fields().body}
          editable={() => !s.sending()}
          onChange={(value) => {
            if (value !== s.fields().body) s.edit('body', value);
          }}
          captureEditor={a.captureEmailEditor}
          placeholder="Outgoing message"
          floatingFormatMenu
          autoLinkMatchMode="common-tlds"
          portalScope="local"
          domRef={(element) =>
            element.setAttribute('aria-label', 'Outgoing message')
          }
          class="h-auto min-h-28 text-base text-ink [&>[contenteditable]]:min-h-28"
          onEnter={(event) => {
            if (!(event.metaKey || event.ctrlKey) || event.isComposing)
              return false;
            fireAndForget(s.submit(), 'universal-input');
            return true;
          }}
        />
      </div>
    </div>
  );
}
