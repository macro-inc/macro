import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailComposeContextOptions } from '../email-compose/compose-adapter';
import { createComposeContext } from '../email-compose/tests/capabilities';
import { EmailThread } from './email-thread';
import { createThreadContext, message, thread } from './tests/fixtures';
import type { EmailThreadSurfaceProps } from './views/email-thread-surface';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  clearDraft: vi.fn(),
  source: vi.fn(),
  composeOptions: vi.fn<(options: EmailComposeContextOptions) => void>(),
}));
vi.mock('@queries/email/thread', () => ({ useThreadQuery: mocks.query }));
vi.mock('@queries/email/draft-cache', () => ({
  clearSavedDraftThreadCache: mocks.clearDraft,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@notifications', () => ({
  createEffectOnEntityTypeNotification: vi.fn(),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'viewer@example.com',
  useUserContext: () => ({ isLoading: () => false }),
}));
vi.mock('@core/user', () => ({ useContacts: () => () => [] }));
vi.mock('../email-compose/compose-adapter', () => ({
  createEmailComposeContext: (options: EmailComposeContextOptions) => {
    mocks.composeOptions(options);
    return createComposeContext();
  },
}));
vi.mock('../email-compose/compose-host-adapter', () => ({
  createEmailComposeHost: () => ({}),
}));
vi.mock('../email-message/attachment-action-adapter', () => ({
  createEmailAttachmentOpener: () => vi.fn(),
}));
vi.mock('../email-message/rendering-adapter', () => ({
  createEmailRenderingContext: () => ({}),
}));
vi.mock('../email-message/sender-icon-adapter', () => ({
  EmailSenderIcon: () => null,
}));
vi.mock('./thread-action-adapter', () => ({
  createThreadActionAdapter: vi.fn(),
}));
vi.mock('./views/email-thread-surface', () => ({
  EmailThreadSurface: (props: EmailThreadSurfaceProps) => {
    const source = props.context.thread.source;
    mocks.source(source);
    return (
      <div>
        <span data-testid="body">
          {source.thread()?.messages[0]?.body_text}
        </span>
        <button onClick={() => void source.fetchOlder()}>Older</button>
        <button onClick={() => void source.refresh()}>Refresh</button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('email thread query ownership', () => {
  it('renders and observes the load gate source without starting another query', () => {
    mocks.query.mockImplementation(() => {
      throw new Error('Duplicate thread query');
    });
    const [snapshot, setSnapshot] = createSignal(
      thread([message('first', { body_text: 'Cached body' })])
    );
    const [transport, setTransport] = createSignal<'graphql' | 'rest'>(
      'graphql'
    );
    const fetchOlder = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});
    const source = createThreadContext({
      thread: snapshot,
      fetchOlder,
      refresh,
    }).source;
    const view = render(() => (
      <EmailThread
        title="Subject"
        threadId={source.id}
        source={source}
        threadTransport={transport}
      />
    ));
    expect(screen.getByTestId('body').textContent).toBe('Cached body');
    expect(mocks.source).toHaveBeenCalledWith(source);
    expect(mocks.query).not.toHaveBeenCalled();
    const options = mocks.composeOptions.mock.calls[0][0];
    expect(options.threadTransport?.()).toBe('graphql');
    setTransport('rest');
    expect(options.threadTransport?.()).toBe('rest');
    expect(mocks.query).not.toHaveBeenCalled();

    setSnapshot(thread([message('first', { body_text: 'Updated body' })]));
    expect(screen.getByTestId('body').textContent).toBe('Updated body');
    fireEvent.click(screen.getByText('Older'));
    fireEvent.click(screen.getByText('Refresh'));
    expect(fetchOlder).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    view.unmount();
    expect(mocks.clearDraft).toHaveBeenCalledWith('thread');
  });
});
