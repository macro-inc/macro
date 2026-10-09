import type { ThreadQueryData, ThreadQueryResult } from '@queries/email/thread';
import { render, waitFor } from '@solidjs/testing-library';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EmailReplySession } from '../../email-compose/context/email-form-inputs';
import type { LocalDraft } from '../../email-compose/core/local-draft';
import { createComposeContext } from '../../email-compose/tests/capabilities';
import type { EmailMessage } from '../../email-message/core/email-message';
import { EmailThreadStateProvider } from '../context/email-thread-state-context';
import { EmailThreadViewProvider } from '../context/email-thread-view-context';
import {
  createEmailThreadState,
  type EmailThreadState,
} from '../primitives/email-thread-state';
import { createEmailThreadSource } from '../queries/thread-source';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { ThreadReplyInput } from './thread-reply-input';

const lifecycle = vi.hoisted(() => ({
  mounted: [] as string[],
  disposed: [] as string[],
}));
const discovery = vi.hoisted(() => ({
  list: vi.fn<() => Promise<LocalDraft[]>>(async () => []),
  subscribe: vi.fn<(listener: () => void) => () => void>(() => () => {}),
}));
vi.mock('@queries/email/local-drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/email/local-drafts')>()),
  listLocalDrafts: discovery.list,
  localDraftStore: { subscribe: discovery.subscribe },
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    getQueryCache: () => ({ subscribe: () => () => {} }),
  },
}));
vi.mock('@queries/calendar/invitations', () => ({
  invalidateInvitationScheduling: vi.fn(),
}));
beforeEach(() => {
  lifecycle.mounted.length = 0;
  lifecycle.disposed.length = 0;
  discovery.list.mockReset().mockResolvedValue([]);
  discovery.subscribe.mockClear();
});
// Probe the wrapper's editor lifetime and focus handoff. This does not verify
// the real rich editor, which still depends on shared application providers.
vi.mock('../../email-compose/views/reply-input', () => ({
  ReplyInputView: (props: {
    replyingTo: () => { db_id: string };
    onEngaged: () => void;
    session: EmailReplySession;
    preloadedHtml: string;
    sideEffectOnSend?: (id: string) => Promise<void>;
  }) => {
    const id = props.replyingTo().db_id;
    lifecycle.mounted.push(id);
    onCleanup(() => lifecycle.disposed.push(id));
    return (
      <>
        <button onClick={props.onEngaged}>
          {id}
          <span>{props.preloadedHtml}</span>
        </button>
        <button onClick={() => props.session.exitToThread('last')}>
          Exit reply
        </button>
        <button onClick={() => void props.sideEffectOnSend?.('sent')}>
          Complete send
        </button>
      </>
    );
  },
}));

it('waits for local reply discovery before mounting an editor and preserves it during refresh', async () => {
  const pending = Promise.withResolvers<LocalDraft[]>();
  discovery.list.mockReturnValueOnce(pending.promise);
  const parent = message('parent');
  let source!: ReturnType<typeof createEmailThreadSource>;
  const view = render(() => {
    source = createEmailThreadSource(() => 'thread', {
      transport: 'graphql',
      isSuccess: true,
      isLoading: false,
      isError: false,
      resolvedThreadId: 'thread',
      data: { thread: thread([parent]), hasMore: false },
    } as ThreadQueryResult<ThreadQueryData>);
    const context = createThreadContext(source);
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
          <ThreadReplyInput
            replyingTo={() => parent}
            draft={state.drafts.getDraftForMessage(parent.db_id)}
          />
        </EmailThreadStateProvider>
      </EmailThreadViewProvider>
    );
  });
  try {
    expect(source.isLoading()).toBe(true);
    expect(lifecycle.mounted).toEqual([]);
    await waitFor(() => expect(discovery.list).toHaveBeenCalledOnce());
    pending.resolve([
      {
        key: 'local-reply',
        accountId: 'owner',
        generation: 'generation',
        revision: 1,
        acknowledgedRevision: 0,
        draftId: 'local-reply',
        threadId: 'thread',
        content: {
          subject: 'Reply',
          replying_to_id: 'parent',
          body_html: btoa('<p>Recovered reply</p>'),
        },
        attachments: [],
        status: 'dirty',
        updatedAt: Date.now(),
      },
    ]);
    await waitFor(() =>
      expect(view.getByText('<p>Recovered reply</p>')).toBeDefined()
    );
    expect(source.isLoading()).toBe(false);
    expect(lifecycle.mounted).toEqual(['parent']);
    view.getByText('parent').click();
    const refresh = Promise.withResolvers<LocalDraft[]>();
    discovery.list.mockReturnValueOnce(refresh.promise);
    discovery.subscribe.mock.calls[0][0]();
    expect(source.isLoading()).toBe(false);
    expect(view.getByText('<p>Recovered reply</p>')).toBeDefined();
    refresh.resolve([]);
    await waitFor(() => expect(discovery.list).toHaveBeenCalledTimes(2));
    expect(lifecycle.mounted).toEqual(['parent']);
    expect(lifecycle.disposed).toEqual([]);
  } finally {
    pending.resolve([]);
    view.unmount();
  }
});

function ThreadTestProvider(props: {
  messages: EmailMessage[];
  refresh?: () => Promise<void>;
  children: (state: EmailThreadState) => JSX.Element;
}) {
  const context = createThreadContext({
    thread: () => thread(props.messages),
    ...(props.refresh && { refresh: props.refresh }),
  });
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

it('focuses the sent card in its own pane before the thread refresh finishes', async () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const refresh = Promise.withResolvers<void>();
  const parent = message('parent');
  const Pane = () => (
    <ThreadTestProvider
      messages={[parent, message('sent')]}
      refresh={() => refresh.promise}
    >
      {(state) => (
        <div ref={state.registerMessagesContainer}>
          <div tabIndex={0} data-testid="sent-card">
            <div data-message-body-id="sent" />
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
    view.getAllByText('Complete send')[1].click();
    expect(document.activeElement).toBe(view.getAllByTestId('sent-card')[1]);
    refresh.resolve();
    await refresh.promise;
    expect(document.activeElement).toBe(view.getAllByTestId('sent-card')[1]);
  } finally {
    refresh.resolve();
    view.unmount();
    vi.unstubAllGlobals();
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
