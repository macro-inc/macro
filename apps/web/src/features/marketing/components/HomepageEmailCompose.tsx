import { ComposeProvider } from '@app/features/email-compose/context/compose-context';
import type { ComposeContextValue } from '@app/features/email-compose/primitives/compose-view-state';
import { ComposeLayout } from '@app/features/email-compose/views/compose-layout';
import { EmailComposeToolbar } from '@app/features/email-compose/views/compose-toolbar';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { ComposerSurface } from '@ui';
import { Avatar } from '@ui/components/Avatar';
import { createSignal, For, Show } from 'solid-js';
import { homepagePeople } from '../core/homepage-demo-people';

/** The app composer with local-only state: sending never leaves the demo. */
export default function HomepageEmailCompose() {
  const [subject, setSubject] = createSignal('Thursday’s launch');
  const [sent, setSent] = createSignal(false);
  const [attachmentError, setAttachmentError] = createSignal('');
  const [attachments, setAttachments] = createSignal<
    ReturnType<ComposeContextValue['attachments']>
  >([]);
  const config = buildConfig('markdown')
    .namespace('homepage-email')
    .withHistory()
    .withSkipPreviewFetch();
  const ctx: ComposeContextValue = {
    recipients: () => ({ to: [], cc: [], bcc: [] }),
    subject,
    setSubject,
    attachments,
    sendTime: () => null,
    initialHtml: () => undefined,
    setRecipients: () => {},
    onContentChange: () => {},
    onAddAttachments: (items) => {
      setAttachmentError('');
      setAttachments((previous) => [...previous, ...items]);
    },
    onRemoveAttachment: (item) =>
      setAttachments((previous) => previous.filter((entry) => entry !== item)),
    captureEditor: () => {},
    onSend: () => setSent(true),
    disabled: () => false,
    isSending: () => false,
    hasDraft: () => false,
    validationError: () => undefined,
    recipientOptions: () => [],
    focusRecipientsOnMount: false,
    hasPaidAccess: () => true,
    isMobile: () => false,
    scheduleEnabled: false,
    attachmentFailure: setAttachmentError,
    bodyActions: {
      recipientAdded: () => {},
      readDroppedFiles: () => {},
      pasteFiles: () => {},
    },
  };

  return (
    <div class="workspace-demo portal-scope" data-theme="dark">
      <div class="homepage-compose-status" aria-live="polite">
        <span>{sent() ? `Sent · ${subject()}` : 'Draft email'}</span>
        <span>Interactive demo</span>
      </div>
      <ComposeProvider value={ctx}>
        <ComposerSurface as="div">
          <ComposeLayout
            class="size-full p-4 sm:p-6 flex flex-col min-h-0"
            header={
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-sm text-ink-placeholder w-14 shrink-0">
                  From
                </span>
                <span class="inline-flex items-center gap-2 py-1 px-2 bg-active rounded-full text-sm">
                  <Avatar size="md" highlightEdge>
                    <Avatar.Image src={homepagePeople.jacob.photo} alt="" />
                    <Avatar.Fallback>JB</Avatar.Fallback>
                  </Avatar>
                  Jacob Beckerman
                </span>
              </div>
            }
            recipients={(visibility) => (
              <For
                each={[
                  'To',
                  ...(visibility.cc ? ['Cc'] : []),
                  ...(visibility.bcc ? ['Bcc'] : []),
                ]}
              >
                {(label) => (
                  <label class="min-h-12 flex items-center gap-2 border-b border-edge-muted">
                    <span class="text-sm text-ink-placeholder w-14 shrink-0">
                      {label}
                    </span>
                    <input
                      aria-label={label}
                      class="min-w-0 flex-1 bg-transparent text-sm py-3 outline-none"
                      value={
                        label === 'To'
                          ? 'Dana Whitfield <dana@example.com>'
                          : ''
                      }
                      placeholder="Email address"
                    />
                  </label>
                )}
              </For>
            )}
            body={
              <>
                <MarkdownShell
                  config={config}
                  class="min-h-60 text-sm leading-6"
                  initialValue={
                    'Hi Dana,\n\nWe’re launching on Thursday at 9 AM. I’ll put together a Q3 launch plan with the checklist and owners, then share it with you.\n\nThanks!'
                  }
                  placeholder="Write your email…"
                  portalScope="local"
                />
                <For each={attachments()}>
                  {(item) => (
                    <div class="flex items-center justify-between text-sm py-2">
                      <span>
                        {item.type === 'local' ? item.file.name : 'Attachment'}
                      </span>
                      <button
                        type="button"
                        onClick={() => ctx.onRemoveAttachment(item)}
                        aria-label="Remove attachment"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </For>
                <Show when={attachmentError()}>
                  <p role="alert" class="text-sm">
                    {attachmentError()}
                  </p>
                </Show>
                <Show when={sent()}>
                  <div
                    class="text-sm text-ink-muted flex gap-3 items-center"
                    role="status"
                  >
                    Sent in this demo.
                    <button
                      type="button"
                      class="underline"
                      onClick={() => setSent(false)}
                    >
                      Edit again
                    </button>
                  </div>
                </Show>
              </>
            }
            toolbar={
              <EmailComposeToolbar
                editor={() => config.buildHandle().controls.getLexical()}
              />
            }
          />
        </ComposerSurface>
      </ComposeProvider>
    </div>
  );
}
