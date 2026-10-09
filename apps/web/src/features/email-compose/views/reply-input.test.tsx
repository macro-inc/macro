import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { ErrorBoundary } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import { createComposeContext } from '../tests/capabilities';
import { ReplyInputView } from './reply-input';

const capture = vi.hoisted(() => vi.fn());
// Stop at the controller boundary: this suite verifies which restored content
// the view supplies, without mounting app-owned editor plugins and toolbars.
vi.mock('../primitives/reply-composer', () => ({
  createReplyComposer: (options: unknown) => {
    capture(options);
    throw new Error('Controller boundary reached');
  },
}));
vi.mock('@ui', () => ({}));
vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({})
);
vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({}));
vi.mock('@components/app/split-layout/split-router/mention-links', () => ({}));
vi.mock('@core/hotkey/hotkeys', () => ({}));
vi.mock('../components/attachment-viewer', () => ({}));
vi.mock('./reply-envelope', () => ({}));

afterEach(() => {
  cleanup();
  capture.mockClear();
});
it.each([
  { body: '', expected: '' },
  { body: '', text: 'Stale plain text', expected: '' },
  {
    body: undefined,
    text: 'Plain & simple',
    expected:
      '<div><span style="white-space: pre-wrap;">Plain &amp; simple</span></div>',
  },
  { body: undefined, expected: '' },
  { body: null, expected: '' },
  { body: btoa('<p>Saved reply</p>'), expected: '<p>Saved reply</p>' },
  { body: undefined, missing: true, expected: '<p>Seed quote</p>' },
])(
  'restores authoritative reply HTML ($body, missing=$missing)',
  async ({ body, text, missing, expected }) => {
    const context = createComposeContext();
    context.drafts.readDraft = async () =>
      missing
        ? undefined
        : {
            draft: message('draft', {
              is_draft: true,
              body_html_sanitized: body,
              body_text: text,
            }),
            persistence: 'queued',
          };
    render(() => (
      <ErrorBoundary fallback={<div>Controller captured</div>}>
        <ReplyInputView
          context={context}
          draft={message('draft', { is_draft: true })}
          preloadedHtml="<p>Seed quote</p>"
          sourceEntityId="thread"
          replyingTo={() => message('parent')}
          session={{
            thread: () => undefined,
            recipientOptions: () => [],
            isPersonalReply: () => false,
            onDraftRemoved() {},
            exitToThread: () => false,
            replyRequest: { replyType: () => undefined, clear() {} },
          }}
        />
      </ErrorBoundary>
    ));
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({ preloadedHtml: expected })
      )
    );
  }
);

vi.mock('@app/features/email-message/components/attachment-pill', () => ({}));
vi.mock('@core/component/FileDropOverlay', () => ({}));
vi.mock(
  '@core/component/LexicalMarkdown/plugins/ios-cursor-scroll',
  () => ({})
);
vi.mock('@core/directive/fileFolderDrop', () => ({}));
vi.mock('@core/directive/fileSelector', () => ({}));
vi.mock('@core/hotkey/tokens', () => ({}));
vi.mock('@core/mobile/useTouchOutsideToDismissKeyboard', () => ({}));
vi.mock('../components/draft-sync-status', () => ({}));
vi.mock('../components/email-date-selector', () => ({}));
vi.mock('../components/email-schedule-summary', () => ({}));
vi.mock('../components/macro-signature-button', () => ({}));
vi.mock('../components/mobile-reply-toolbar', () => ({}));
vi.mock('../components/signature-preview', () => ({}));
vi.mock('../primitives/prepare-email-body', () => ({}));
