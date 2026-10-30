import { render, waitFor } from '@solidjs/testing-library';
import { createSignal, onCleanup, Show } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createComposeContext } from '../../email-compose/tests/capabilities';
import { mountEmailComposer } from '../../email-compose/tests/composer';
import type { EmailComposeViewProps } from '../../email-compose/views/email-compose';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { EmailThreadSurface } from './email-thread-surface';

// Exercise the real thread-to-composer host wiring and discard controller;
// replace rich-editor chrome and unrelated conversation controls.
vi.mock('../../email-compose/views/email-compose', () => ({
  EmailComposeView: (props: EmailComposeViewProps) => {
    const composer = mountEmailComposer(props.context, props.host, {
      draft: props.draft,
    });
    onCleanup(composer.dispose);
    return (
      <button onClick={() => composer.state.context.onDelete?.()}>
        Delete draft
      </button>
    );
  },
}));
vi.mock('../primitives/thread-navigation', () => ({
  createThreadNavigation: () => ({}),
}));
vi.mock('@core/component/CustomScrollbar', () => ({
  CustomScrollbar: () => null,
}));
vi.mock('./message-list', () => ({ MessageList: () => null }));
vi.mock('./bottom-reply-buttons', () => ({ BottomReplyButtons: () => null }));
vi.mock('./mobile-email-compose', () => ({
  MobileEmailCompose: () => null,
}));

it.each(['accepted', 'rejected'] as const)(
  'keeps discard in the owning email view when deletion is %s',
  async (outcome) => {
    const compose = createComposeContext();
    const pending = Promise.withResolvers<void>();
    vi.mocked(compose.drafts.deleteDraft).mockReturnValueOnce(pending.promise);
    const [detailOpen, setDetailOpen] = createSignal(true);
    const returnToList = vi.fn(() => setDetailOpen(false));
    const splitBack = vi.fn();
    const draft = message('draft', { is_draft: true, replying_to_id: null });
    const view = render(() => (
      <Show when={detailOpen()} fallback={<p>Email list</p>}>
        <EmailThreadSurface
          title="Draft"
          threadId={() => 'thread'}
          host={{ returnToList }}
          context={{
            thread: createThreadContext({ thread: () => thread([draft]) }),
            compose,
            composeHost: { goBack: splitBack },
            rendering: {},
          }}
          emailRendering={{
            theme: () => ({
              inkL: 0,
              inkC: 0,
              inkH: 0,
              panelL: 1,
              accentL: 0,
              accentC: 0,
              accentH: 0,
            }),
            resolveImages: async () => {},
          }}
        />
      </Show>
    ));
    try {
      view.getByText('Delete draft').click();
      expect(view.getByText('Email list')).toBeTruthy();
      expect(returnToList).toHaveBeenCalledOnce();
      await waitFor(() =>
        expect(compose.drafts.deleteDraft).toHaveBeenCalledOnce()
      );
      if (outcome === 'accepted') {
        pending.resolve();
      } else {
        pending.reject(new Error('Deletion failed'));
        await waitFor(() =>
          expect(compose.notices.feedback.failure).toHaveBeenCalledWith(
            'Failed to delete draft'
          )
        );
      }
      await pending.promise.catch(() => {});
      expect(view.getByText('Email list')).toBeTruthy();
      expect(returnToList).toHaveBeenCalledOnce();
      expect(splitBack).not.toHaveBeenCalled();
      expect(compose.drafts.saveDraft).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  }
);
