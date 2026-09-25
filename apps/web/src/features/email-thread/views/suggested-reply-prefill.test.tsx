import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComposeContext } from '../../email-compose/tests/capabilities';
import { EmailThreadStateProvider } from '../context/email-thread-state-context';
import { EmailThreadViewProvider } from '../context/email-thread-view-context';
import { createEmailThreadState } from '../primitives/email-thread-state';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { ThreadReplyInput } from './thread-reply-input';

vi.mock('@app/features/email-compose/views/reply-input', () => ({
  ReplyInputView: (props: { preloadedHtml?: string }) => (
    <div data-testid="preloaded-html">{props.preloadedHtml}</div>
  ),
}));

afterEach(cleanup);

describe('suggested reply prefill', () => {
  it('survives an early draft-seed remount after its request is consumed', () => {
    const target = message('message');
    const threadContext = createThreadContext({
      thread: () => thread([target]),
    });
    const state = createEmailThreadState(threadContext);
    const [draft, setDraft] = createSignal<ReturnType<typeof message>>();
    state.replyRequest.set('message', 'reply-all', 'Suggested response');

    render(() => (
      <EmailThreadViewProvider
        value={{
          thread: threadContext,
          hasProfessionalFeatures: () => true,
          compose: createComposeContext(),
          rendering: {},
        }}
      >
        <EmailThreadStateProvider value={state}>
          <ThreadReplyInput replyingTo={() => target} draft={draft()} />
        </EmailThreadStateProvider>
      </EmailThreadViewProvider>
    ));

    expect(screen.getByTestId('preloaded-html').textContent).toContain(
      'Suggested response'
    );

    state.replyRequest.clear();
    setDraft(
      message('draft', {
        is_draft: true,
        replying_to_id: 'message',
        body_html_sanitized: null,
        body_text: null,
        updated_at: '2026-09-24T23:40:00Z',
      })
    );

    expect(screen.getByTestId('preloaded-html').textContent).toContain(
      'Suggested response'
    );
  });
});
