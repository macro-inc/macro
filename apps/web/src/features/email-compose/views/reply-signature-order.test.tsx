import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, onMount } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type { EmailInbox } from '../context/compose-capabilities';
import { EmailFormContextProvider } from '../context/email-form-context';
import type { ReplyType } from '../core/reply-type';
import { createComposeContext } from '../tests/capabilities';
import { createEmailEditor } from '../tests/editor';
import { ReplyInputView } from './reply-input';

// Keep the real view, reply composer and signature preview. Stub only
// app-owned editor plugins and presentation unrelated to the layout order.
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  useHotkeyDOMScope: () => [() => {}, 'reply'],
}));
vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      const config = {
        withAppLinkResolver: () => config,
        namespace: () => config,
        withMentions: () => config,
        withEmojis: () => config,
        withLinks: () => config,
        withHistory: () => config,
        withMedia: () => config,
        withCode: () => config,
        withCheckboxToTask: () => config,
        withRestoreFocus: () => config,
        withSelectionData: () => config,
        withFloatingFormatMenu: () => config,
        use: () => config,
        onChange: () => config,
        withFilePaste: () => config,
        buildHandle: () => ({ lexical: createEmailEditor('Sounds good') }),
      };
      return config;
    },
  })
);
vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { onConnect?: () => void }) => {
    onMount(() => props.onConnect?.());
    return <div role="textbox" aria-label="Message" />;
  },
}));
vi.mock('@components/app/split-layout/split-router/mention-links', () => ({
  useMacroMentionLinkResolver: () => undefined,
}));
vi.mock('@ui', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  Surface: (props: JSX.HTMLAttributes<HTMLDivElement>) => (
    <div ref={props.ref}>{props.children}</div>
  ),
  Tooltip: (props: { children: JSX.Element }) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  SendButton: () => <button>Send</button>,
}));
vi.mock('../components/mobile-reply-toolbar', () => ({
  MobileReplyToolbar: () => null,
}));
vi.mock('../components/draft-back-menu', () => ({ DraftBackMenu: () => null }));
vi.mock('../components/attachment-viewer', () => ({
  createAttachmentViewer: () => ({}),
}));
vi.mock('../components/draft-sync-status', () => ({
  DraftSyncStatus: () => null,
}));
vi.mock('../components/email-schedule-summary', () => ({
  EmailScheduleBar: () => null,
  EmailScheduleSummary: () => null,
}));
vi.mock('./reply-envelope', () => ({ ReplyEnvelope: () => null }));
vi.mock('@core/component/FileDropOverlay', () => ({
  FileDropOverlay: () => null,
}));
vi.mock('@core/directive/fileFolderDrop', () => ({ fileFolderDrop: () => {} }));
vi.mock('@core/mobile/useTouchOutsideToDismissKeyboard', () => ({
  useTouchOutsideToDismissKeyboard: () => {},
}));

afterEach(cleanup);

const parent = message('parent', {
  from: { name: 'Ada Lovelace', email: 'ada@example.com' },
  to: [{ email: 'me@example.com' }],
  subject: 'Numbers',
  body_html_sanitized: '<p>Original message text</p>',
});

function mount(
  provider: EmailInbox['provider'],
  layout: 'desktop' | 'mobile',
  replyType: ReplyType
) {
  const context = createComposeContext();
  context.accounts.inboxes = () => [
    {
      id: 'inbox',
      email_address: 'me@example.com',
      provider,
      settings: {
        signature: '<p>Regards, Me</p>',
        signature_on_replies_forwards: true,
      },
    },
  ];
  context.presentation.signaturesEnabled = () => true;
  context.presentation.scheduleEnabled = false;
  context.presentation.isTouch = () => layout === 'mobile';
  context.presentation.isMobile = () => layout === 'mobile';
  const [requested, setRequested] = createSignal<ReplyType | undefined>(
    replyType
  );
  render(() => (
    <EmailFormContextProvider
      context={{
        viewerEmail: context.viewerEmail,
        inboxes: context.accounts.inboxes,
      }}
      formOptions={{
        getMessageById: () => parent,
        getDraftForMessageReply: () => undefined,
      }}
    >
      <ReplyInputView
        context={context}
        sourceEntityId="thread"
        replyingTo={() => parent}
        session={{
          thread: () => ({
            db_id: 'thread',
            link_id: 'inbox',
            inbox_visible: true,
          }),
          recipientOptions: () => [],
          isPersonalReply: () => false,
          onDraftRemoved() {},
          exitToThread: () => false,
          replyRequest: {
            replyType: requested,
            clear: () => setRequested(undefined),
          },
        }}
        mobileCompose={
          layout === 'mobile'
            ? {
                portalMount: () => undefined,
                onClose() {},
                registerClose() {},
              }
            : undefined
        }
      />
    </EmailFormContextProvider>
  ));
}

/** Names the composer rows in the order a reader meets them. */
function readingOrder(rows: Record<string, Element>) {
  return Object.entries(rows)
    .sort(([, a], [, b]) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    )
    .map(([name]) => name);
}

const cases = (['GMAIL', 'OUTLOOK'] as const).flatMap((provider) =>
  (['desktop', 'mobile'] as const).map((layout) => ({ provider, layout }))
);

// Sending inserts the signature above the quoted thread for both providers,
// so the preview has to sit between the message and the quote controls.
it.each(cases)(
  'previews the $provider reply signature above the quoted text on $layout',
  async ({ provider, layout }) => {
    mount(provider, layout, 'reply');

    const quote = await screen.findByRole('button', { name: 'quoted text' });
    expect(
      readingOrder({
        quote,
        signature: screen.getByRole('button', { name: 'Signature' }),
        message: screen.getByRole('textbox', { name: 'Message' }),
      })
    ).toEqual(['message', 'signature', 'quote']);
  }
);

it.each(cases)(
  'previews the $provider forward signature above the forwarded message on $layout',
  async ({ provider, layout }) => {
    mount(provider, layout, 'forward');

    const forwarded = await screen.findByRole('button', {
      name: 'Show forwarded message',
    });
    expect(
      readingOrder({
        forwarded,
        signature: screen.getByRole('button', { name: 'Signature' }),
        message: screen.getByRole('textbox', { name: 'Message' }),
      })
    ).toEqual(['message', 'signature', 'forwarded']);
  }
);
