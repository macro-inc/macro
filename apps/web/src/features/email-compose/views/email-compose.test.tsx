import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import {
  type ComponentProps,
  type JSX,
  type ParentProps,
  Show,
} from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmailDraftStorage } from '../context/compose-capabilities';
import { useCompose } from '../context/compose-context';
import { createComposeContext } from '../tests/capabilities';
import { createEmailEditor, setEmailEditorText } from '../tests/editor';
import { EmailComposeView } from './email-compose';

vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: () => null,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  SplitHeaderBadge: () => null,
  StaticSplitLabel: () => null,
}));
vi.mock('@core/component/EmailPermissionsBanner', () => ({
  EmailPermissionsBanner: () => <p>No email account connected.</p>,
}));
vi.mock('@core/mobile/WrapUnlessMobile', () => ({
  WrapUnlessMobile: (props: ParentProps) => props.children,
}));
vi.mock('@ui', () => ({
  ComposerSurface: (props: ParentProps) => props.children,
}));
vi.mock('../components/signature-preview', () => ({
  SignaturePreview: () => null,
}));
vi.mock('../components/email-schedule-summary', () => ({
  EmailScheduleBar: () => null,
}));
vi.mock('../components/draft-sync-status', () => ({
  DraftSyncStatus: (props: { state?: { message: string } }) => (
    <Show when={props.state}>{(state) => <p>{state().message}</p>}</Show>
  ),
}));
vi.mock('./compose-toolbar', () => ({ EmailComposeToolbar: () => null }));
vi.mock('@components/app/mobile/MobileDrawer', () => {
  const passthrough = (props: ParentProps) => props.children;
  return {
    MobileDrawer: Object.assign(
      (props: ParentProps<{ open: boolean }>) => (
        <Show when={props.open}>{props.children}</Show>
      ),
      {
        Portal: passthrough,
        Overlay: () => null,
        Content: passthrough,
        Handle: () => null,
        Section: passthrough,
        Item: (props: ComponentProps<'button'>) => <button {...props} />,
      }
    ),
  };
});
vi.mock('./compose-layout', () => ({
  ComposeLayout: (props: { notice?: JSX.Element }) => {
    const state = useCompose();
    const editor = createEmailEditor();
    state.captureEditor(editor);
    state.onContentChange('');
    return (
      <>
        {props.notice}
        <input
          aria-label="Message"
          onInput={(event) => {
            setEmailEditorText(editor, event.currentTarget.value);
            state.onContentChange(event.currentTarget.value);
          }}
        />
      </>
    );
  },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
afterEach(cleanup);

it('keeps the page’s New button from floating over the full-screen composer', () => {
  const slot = document.createElement('div');
  document.body.append(slot);
  FloatRegions.setMount('accessory', slot);
  const page = render(() => (
    <FloatRegion region="accessory" priority={-1}>
      <button type="button">New</button>
    </FloatRegion>
  ));
  expect(within(slot).getByRole('button', { name: 'New' })).toBeDefined();

  const composer = render(() => (
    <EmailComposeView context={createComposeContext()} />
  ));
  expect(within(slot).queryByRole('button', { name: 'New' })).toBeNull();

  composer.unmount();
  expect(within(slot).getByRole('button', { name: 'New' })).toBeDefined();
  page.unmount();
  slot.remove();
});

it('keeps a draft sync failure visible without a connected inbox', () => {
  const context = createComposeContext();
  context.accounts.inboxes = () => [];
  context.drafts.saveLocalDraft = vi.fn();
  context.drafts.syncAvailability = () => 'unavailable';
  render(() => <EmailComposeView context={context} draftId="draft" />);
  expect(screen.getByText('No email account connected.')).toBeDefined();
  expect(screen.getByText('Draft synchronization unavailable')).toBeDefined();
});

it.each([false, true])(
  'leaves only after local saving succeeds (failure=%s)',
  async (fails) => {
    const context = createComposeContext();
    context.presentation.isMobile = () => true;
    let finish!: () => void;
    const diskError = new Error('Disk full');
    context.drafts.saveLocalDraft = vi.fn<
      NonNullable<EmailDraftStorage['saveLocalDraft']>
    >(async (input) => {
      await new Promise<void>((resolve, reject) => {
        finish = () => (fails ? reject(diskError) : resolve());
      });
      return {
        key: 'draft',
        accountId: 'owner',
        generation: 'generation',
        revision: 1,
        acknowledgedRevision: 0,
        draftId: 'draft',
        threadId: 'thread',
        content: input.draft,
        attachments: [],
        status: 'dirty',
        updatedAt: Date.now(),
      };
    });
    const goBack = vi.fn();
    let back!: () => boolean;
    render(() => (
      <EmailComposeView
        context={context}
        initialTo={['recipient@example.com']}
        host={{
          goBack,
          registerBack: (handler) => {
            back = handler;
          },
        }}
      />
    ));
    fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Keep my edits' },
    });
    await waitFor(() =>
      expect(context.drafts.saveLocalDraft).toHaveBeenCalled()
    );
    expect(back()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    expect(goBack).not.toHaveBeenCalled();
    finish();
    if (!fails) {
      await waitFor(() => expect(goBack).toHaveBeenCalledOnce());
      expect(screen.queryByRole('button', { name: 'Save Draft' })).toBeNull();
      return;
    }
    await waitFor(() =>
      expect(context.notices.reportError).toHaveBeenCalledWith(diskError)
    );
    expect(goBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save Draft' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveProperty(
      'value',
      'Keep my edits'
    );

    // A subsequent edit retries the local write without losing the editor.
    fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Keep my corrected edits' },
    });
    await waitFor(() =>
      expect(context.drafts.saveLocalDraft).toHaveBeenCalledTimes(2)
    );
    fails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    finish();
    await waitFor(() => expect(goBack).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Save Draft' })).toBeNull();
  }
);
