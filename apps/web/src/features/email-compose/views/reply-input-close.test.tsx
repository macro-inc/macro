import { registerHotkey } from '@core/hotkey/hotkeys';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { type ComponentProps, type JSX, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type { DraftBackMenu } from '../components/draft-back-menu';
import type { MobileReplyToolbar } from '../components/mobile-reply-toolbar';
import { EmailFormContextProvider } from '../context/email-form-context';
import { createComposeContext } from '../tests/capabilities';
import { createEmailEditor } from '../tests/editor';
import { ReplyInputView } from './reply-input';

const fixture = vi.hoisted(() => ({
  text: '',
  onChange: (_value: string) => {},
}));

// Keep the real view, form, draft controller and deletion lifecycle. Stub only
// app-owned editor plugins and presentation unrelated to closing the reply.
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
        onChange: (handler: (value: string) => void) => {
          fixture.onChange = handler;
          return config;
        },
        withFilePaste: () => config,
        buildHandle: () => ({ lexical: createEmailEditor(fixture.text) }),
      };
      return config;
    },
  })
);
vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: () => null,
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
}));
vi.mock('../components/mobile-reply-toolbar', () => ({
  MobileReplyToolbar: (props: ComponentProps<typeof MobileReplyToolbar>) => (
    <button onClick={props.onBack}>Go Back</button>
  ),
}));
vi.mock('../components/draft-back-menu', () => ({
  DraftBackMenu: (props: ComponentProps<typeof DraftBackMenu>) => (
    <Show when={props.open}>
      <button onClick={props.onSave}>Save Draft</button>
      <button onClick={props.onDelete}>Delete Draft</button>
    </Show>
  ),
}));
vi.mock('../components/attachment-viewer', () => ({
  createAttachmentViewer: () => ({}),
}));
vi.mock('../components/draft-sync-status', () => ({
  DraftSyncStatus: () => null,
}));
vi.mock('../components/email-schedule-summary', () => ({
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount(draftId?: string, text = '', context = createComposeContext()) {
  fixture.text = text;
  context.presentation.isTouch = () => true;
  context.presentation.scheduleEnabled = false;
  const draft = draftId
    ? message(draftId, { is_draft: true, body_text: text, subject: '' })
    : undefined;
  const parent = message('parent', { subject: '' });
  const onClose = vi.fn();
  const onDraftRemoved = vi.fn();
  const exitToThread = vi.fn(() => true);
  const setShowReply = vi.fn();
  render(() => (
    <EmailFormContextProvider
      context={{
        viewerEmail: context.viewerEmail,
        inboxes: context.accounts.inboxes,
      }}
      formOptions={{
        getMessageById: () => parent,
        getDraftForMessageReply: () => draft,
      }}
    >
      <ReplyInputView
        context={context}
        draft={draft}
        sourceEntityId="thread"
        replyingTo={() => parent}
        setShowReply={setShowReply}
        session={{
          thread: () => ({
            db_id: 'thread',
            link_id: 'inbox',
            inbox_visible: true,
          }),
          recipientOptions: () => [],
          isPersonalReply: () => false,
          onDraftRemoved,
          exitToThread,
          replyRequest: { replyType: () => undefined, clear() {} },
        }}
        mobileCompose={{
          portalMount: () => undefined,
          onClose,
          registerClose() {},
        }}
      />
    </EmailFormContextProvider>
  ));
  return { context, onClose, onDraftRemoved, exitToThread, setShowReply };
}

it('routes the composer Escape hotkey through the mobile draft choices', () => {
  const state = mount('draft', 'Unsent reply');
  const shortcut = vi
    .mocked(registerHotkey)
    .mock.calls.find(([options]) => options.hotkey === 'escape')?.[0];
  expect(shortcut).toBeDefined();
  shortcut?.keyDownHandler?.(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(screen.getByRole('button', { name: 'Save Draft' })).toBeTruthy();
  expect(state.exitToThread).not.toHaveBeenCalled();
  expect(state.onClose).not.toHaveBeenCalled();
  shortcut?.keyDownHandler?.(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(screen.queryByRole('button', { name: 'Save Draft' })).toBeNull();
  expect(state.onClose).not.toHaveBeenCalled();
});

it('keeps the mobile reply open when saving its working copy fails', async () => {
  const context = createComposeContext();
  const failure = new Error('Local storage is unavailable');
  context.drafts.saveLocalDraft = vi.fn(async () => {
    throw failure;
  });
  const state = mount('draft', 'Keep this unsent reply', context);
  // The real editor emits its initial value before subsequent user edits.
  fixture.onChange('Original reply');
  fixture.onChange('Keep this unsent reply');

  fireEvent.click(screen.getByRole('button', { name: 'Go Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

  await waitFor(() =>
    expect(context.notices.reportError).toHaveBeenCalledWith(failure)
  );
  expect(context.drafts.saveLocalDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      draft: expect.objectContaining({ db_id: 'draft' }),
    })
  );
  expect(screen.getByRole('button', { name: 'Save Draft' })).toBeTruthy();
  expect(state.onClose).not.toHaveBeenCalled();
  expect(state.setShowReply).not.toHaveBeenCalled();
  expect(context.drafts.deleteDraft).not.toHaveBeenCalled();
});

it.each([undefined, 'saved-draft'])(
  'discards an empty reply and clears the preview (identity: %s)',
  async (draftId) => {
    const state = mount(draftId);
    fireEvent.click(screen.getByRole('button', { name: 'Go Back' }));
    await waitFor(() => expect(state.onDraftRemoved).toHaveBeenCalledOnce());
    expect(state.setShowReply).toHaveBeenCalledWith(false);
    expect(state.onClose).not.toHaveBeenCalled();
    if (draftId) {
      expect(state.context.drafts.deleteDraft).toHaveBeenCalledWith(
        expect.objectContaining({ draftId })
      );
    } else {
      expect(state.context.drafts.deleteDraft).not.toHaveBeenCalled();
    }
  }
);
