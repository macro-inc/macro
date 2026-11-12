import { ComposerEditor } from '@core/component/LexicalMarkdown/component/ComposerEditor';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { recipientEntityMapper } from '@core/user/combinedRecipient';
import { fireAndForget } from '@core/util/fireAndForget';
import { onCleanup } from 'solid-js';
import { createConfiguredChannelMarkdownEditor } from '../../channel/Input/configured-markdown-editor';
import { Input } from '../../channel/Input/Input';
import { createMentionsTracker } from '../../channel/Input/mentions-tracker';
import { ComposeFieldRow } from '../../email-compose/components/compose-field-row';
import type { InputDisplay, MessageRecipient } from '../context/capabilities';
import { formatRecipientTerms } from '../core/recipients';
import { createRecipientSelection } from '../primitives/recipient-selection';
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
    // Personal mentions are paged independently of addressing. The accessor
    // keeps this composer personal-only rather than adding CRM references.
    users: () => undefined,
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
  const selected = (text: string): MessageRecipient[] => {
    const resolved = a.recipients({ recipients: text }, true);
    return [
      ...resolved.recipients.flatMap((recipient): MessageRecipient[] => {
        if (recipient.kind === 'user' && recipient.email)
          return [
            recipientEntityMapper('user')({
              id: recipient.id,
              email: recipient.email,
              name: recipient.label,
            }),
          ];
        const channel = a
          .messageChannels()
          .find((option) => option.id === recipient.id);
        return channel ? [channel] : [];
      }),
      ...resolved.unresolved.map((term) => ({
        kind: 'custom' as const,
        id: term,
        data: { id: term, email: term, invalid: true },
      })),
    ];
  };
  const selection = createRecipientSelection(
    () => s.fields().recipients,
    selected,
    (items) => formatRecipientTerms(items.map((item) => item.id)),
    (text) => s.edit('recipients', text)
  );
  return (
    <div class="min-w-0">
      <ComposeFieldRow label="To">
        <RecipientSelector
          createSource={a.createMessageSource}
          selectedOptions={selection.selected()}
          onInputChange={(value) => {
            if (value && !s.draft().edited.message.includes('recipients'))
              s.edit('recipients', s.fields().recipients);
          }}
          setSelectedOptions={selection.select}
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
