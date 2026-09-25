import { ComposeProvider } from '@app/features/email-compose/context/compose-context';
import type { ComposeContextValue } from '@app/features/email-compose/primitives/compose-view-state';
import { ComposeLayout } from '@app/features/email-compose/views/compose-layout';
import { EmailComposeToolbar } from '@app/features/email-compose/views/compose-toolbar';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import {
  getDecorator,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import {
  type DocumentMentionDecoratorProps,
  DocumentMentionNode,
} from '@macro-inc/lexical-core/nodes/DocumentMentionNode';
import { ComposerSurface } from '@ui';
import { Avatar } from '@ui/components/Avatar';
import { createSignal, For, Show } from 'solid-js';
import { homepagePeople } from '../core/homepage-demo-people';
import { createEmailDemoGeneration } from '../primitives/createEmailDemoGeneration';
import { HomepageMention } from './HomepageMention';
import './homepage-email-compose.css';

/** The app composer with local-only state: sending never leaves the demo. */
export default function HomepageEmailCompose() {
  // The public entry does not initialize the authenticated app's decorators.
  // Supply local previews only when that renderer has not been registered.
  if (!getDecorator(DocumentMentionNode)) {
    setDecorator<DocumentMentionDecoratorProps>(
      DocumentMentionNode,
      (props) => (
        <HomepageMention
          kind={props.blockName === 'pdf' ? 'pdf' : 'md'}
          label={props.documentName}
          description={
            props.blockName === 'pdf'
              ? 'Macro product overview and pricing, shared after the demo.'
              : 'The setup steps and owners for Dana’s team.'
          }
          href="#email"
        />
      )
    );
  }
  const [subject, setSubject] = createSignal(
    'Great meeting you — demo follow-up'
  );
  const [sent, setSent] = createSignal(false);
  const [attachmentError, setAttachmentError] = createSignal('');
  const [attachments, setAttachments] = createSignal<
    ReturnType<ComposeContextValue['attachments']>
  >([]);
  const config = buildConfig('markdown')
    .namespace('homepage-email')
    .withHistory()
    .withSkipPreviewFetch();
  let root: HTMLDivElement | undefined;
  const generation = createEmailDemoGeneration(
    () => root,
    () => config.buildHandle().controls.getLexical()
  );
  const generating = () => generation.phase() !== 'complete';
  const ctx: ComposeContextValue = {
    recipients: () => ({
      to: [],
      cc: [
        {
          kind: 'custom',
          id: 'demo-julia',
          data: { id: 'demo-julia', email: 'julia@macro.com', invalid: false },
        },
      ],
      bcc: [],
    }),
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
    disabled: generating,
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

  // Keep one editor instance when ComposeLayout reads its body slot.
  const body = (
    <div data-email-demo-body class="min-h-0 flex-[1_0_auto] overflow-visible">
      <MarkdownShell
        config={config}
        class="h-auto min-h-full overflow-visible text-sm leading-6"
        disabled={generating()}
        onConnect={generation.onReady}
        placeholder="Write your email…"
        portalScope="local"
      />
      <For each={attachments()}>
        {(item) => (
          <div class="flex items-center justify-between text-sm py-2">
            <span>{item.type === 'local' ? item.file.name : 'Attachment'}</span>
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
    </div>
  );

  return (
    <div
      ref={root}
      class="workspace-demo portal-scope homepage-email-demo"
      data-theme="dark"
      data-generation={generation.phase()}
      aria-busy={generating()}
    >
      <ComposeProvider value={ctx}>
        <ComposerSurface
          as="div"
          class="h-auto min-h-[var(--homepage-email-height)]"
        >
          <ComposeLayout
            class="w-full h-auto p-4 sm:p-6 flex flex-col min-h-[var(--homepage-email-height)] [&>div:last-child]:h-auto [&>div:last-child]:flex-1"
            header={
              <div class="flex flex-1 flex-wrap items-center gap-2 min-w-0">
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
                <Show when={generating()}>
                  <span class="ml-auto text-xs text-ink-muted" role="status">
                    Generating<span aria-hidden="true">…</span>
                  </span>
                </Show>
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
                          : label === 'Cc'
                            ? 'Julia Westphal <julia@macro.com>'
                            : ''
                      }
                      disabled={generating()}
                      placeholder="Email address"
                    />
                  </label>
                )}
              </For>
            )}
            body={body}
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
