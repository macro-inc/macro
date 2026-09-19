import { render } from '@solidjs/testing-library';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EmailReplySession } from '../../email-compose/context/email-form-inputs';
import { createComposeContext } from '../../email-compose/tests/capabilities';
import type { EmailMessage } from '../../email-message/core/email-message';
import { EmailThreadStateProvider } from '../context/email-thread-state-context';
import { EmailThreadViewProvider } from '../context/email-thread-view-context';
import {
  createEmailThreadState,
  type EmailThreadState,
} from '../primitives/email-thread-state';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { ThreadReplyInput } from './thread-reply-input';

const lifecycle = vi.hoisted(() => ({
  mounted: [] as string[],
  disposed: [] as string[],
}));
beforeEach(() => {
  lifecycle.mounted.length = 0;
  lifecycle.disposed.length = 0;
});
// Probe the wrapper's editor lifetime and focus handoff. This does not verify
// the real rich editor, which still depends on shared application providers.
vi.mock('../../email-compose/views/reply-input', () => ({
  ReplyInputView: (props: {
    replyingTo: () => { db_id: string };
    onEngaged: () => void;
    session: EmailReplySession;
  }) => {
    const id = props.replyingTo().db_id;
    lifecycle.mounted.push(id);
    onCleanup(() => lifecycle.disposed.push(id));
    return (
      <>
        <button onClick={props.onEngaged}>{id}</button>
        <button onClick={() => props.session.exitToThread('last')}>
          Exit reply
        </button>
      </>
    );
  },
}));

function ThreadTestProvider(props: {
  messages: EmailMessage[];
  children: (state: EmailThreadState) => JSX.Element;
}) {
  const context = createThreadContext({ thread: () => thread(props.messages) });
  const state = createEmailThreadState(context);
  return (
    <EmailThreadViewProvider
      value={{
        thread: context,
        compose: createComposeContext(),
        rendering: {},
      }}
    >
      <EmailThreadStateProvider value={state}>
        {props.children(state)}
      </EmailThreadStateProvider>
    </EmailThreadViewProvider>
  );
}

it('preserves an engaged composer through a same-message update but resets it for a different reply target', () => {
  const first = message('first');
  const second = message('second');
  const [target, setTarget] = createSignal(first);
  const view = render(() => (
    <ThreadTestProvider messages={[first, second]}>
      {() => <ThreadReplyInput replyingTo={target} />}
    </ThreadTestProvider>
  ));
  try {
    view.getByText('first').click();
    setTarget({ ...first, updated_at: '2026-09-05T00:00:00Z' });
    expect(lifecycle.mounted).toEqual(['first']);
    setTarget(second);
    expect(lifecycle.mounted).toEqual(['first', 'second']);
    expect(lifecycle.disposed).toEqual(['first']);
  } finally {
    view.unmount();
  }
});

it('returns focus to the owning thread when split panes contain the same message', () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const parent = message('shared-message');
  const Pane = () => (
    <ThreadTestProvider messages={[parent]}>
      {(state) => (
        <div ref={state.registerMessagesContainer}>
          <div tabIndex={0} data-testid="card">
            <div data-message-body-id={parent.db_id} />
          </div>
          <ThreadReplyInput replyingTo={() => parent} />
        </div>
      )}
    </ThreadTestProvider>
  );
  const view = render(() => (
    <>
      <Pane />
      <Pane />
    </>
  ));
  try {
    view.getAllByText('Exit reply')[1].click();
    expect(document.activeElement).toBe(view.getAllByTestId('card')[1]);
    view.getAllByText('Exit reply')[0].click();
    expect(document.activeElement).toBe(view.getAllByTestId('card')[0]);
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
  }
});
