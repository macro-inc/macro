import { ComposerEditor } from '@core/component/LexicalMarkdown/component/ComposerEditor';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { fireAndForget } from '@core/util/fireAndForget';
import { onCleanup } from 'solid-js';
import { createConfiguredChannelMarkdownEditor } from '../../channel/Input/configured-markdown-editor';
import { Input } from '../../channel/Input/Input';
import { createMentionsTracker } from '../../channel/Input/mentions-tracker';
import { ComposeFieldRow } from '../../email-compose/components/compose-field-row';
import type { InputDisplay, MessageRecipient } from '../context/capabilities';
import type { UniversalInputController } from '../primitives/universal-input';

/** Channel composer slots with Universal Input owning inference and submission. */
export function MessageDraft(props: {
  state: UniversalInputController;
  actions: InputDisplay;
}) {
  const s = props.state;
  const a = props.actions;
  const mentions = createMentionsTracker();
  a.captureMessageMentions?.(mentions.mentions);
  onCleanup(() => a.captureMessageMentions?.(undefined));
  const config = createConfiguredChannelMarkdownEditor({
    namespace: 'universal-message',
    resolveAppLink: a.resolveAppLink,
    users: () =>
      a
        .messageRecipients()
        .flatMap((option) => (option.kind === 'user' ? [option.data] : [])),
    onMentionCreate: mentions.onMentionCreate,
    onMentionRemove: mentions.onMentionRemove,
    onChange: (value) => {
      if (value !== s.fields().body) s.edit('body', value);
    },
    onEnter: (event) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.isComposing ||
        config.controls.isInlineMenuOpen()
      )
        return false;
      fireAndForget(s.submit(), 'universal-input');
      return true;
    },
  });
  const selected = (): MessageRecipient[] => {
    const resolved = a.recipients(s.fields(), true);
    return [
      ...resolved.recipients.flatMap((recipient) => {
        const option = a
          .messageRecipients()
          .find((option) => option.id === recipient.id);
        return option ? [option] : [];
      }),
      ...resolved.unresolved.map((term) => ({
        kind: 'custom' as const,
        id: term,
        data: { id: term, email: term, invalid: true },
      })),
    ];
  };
  return (
    <div class="min-w-0">
      <ComposeFieldRow label="To">
        <RecipientSelector
          options={a.messageRecipients}
          selectedOptions={selected()}
          onInputChange={(value) => {
            if (value && !s.draft().edited.message.includes('recipients'))
              s.edit('recipients', s.fields().recipients);
          }}
          setSelectedOptions={(next) =>
            s.edit('recipients', next.map((item) => item.id).join(', '))
          }
          allowCustomRecipients={false}
          includeSelf
          focusOnMount={false}
          openOnFocus={false}
          hideBorder
          noPadding
          disabled={s.sending()}
          inputRef={(input) =>
            input.setAttribute('aria-label', 'To person or channel')
          }
          portalScope="local"
        />
      </ComposeFieldRow>
      <Input.Root
        input={{
          mode: 'channel',
          value: s.fields().body,
        }}
        class="w-full max-w-none"
      >
        <Input.Layout>
          <Input.Layout.Body>
            <Input.Layout.Editor>
              <Input.Editor>
                <ComposerEditor
                  config={config}
                  value={s.fields().body}
                  disabled={s.sending()}
                  placeholder="Write a message…"
                  ariaLabel="Outgoing message"
                  portalScope="local"
                />
              </Input.Editor>
            </Input.Layout.Editor>
          </Input.Layout.Body>
        </Input.Layout>
      </Input.Root>
    </div>
  );
}
