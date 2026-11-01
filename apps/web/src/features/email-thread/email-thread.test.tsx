import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailComposeContextOptions } from '../email-compose/compose-adapter';
import { createComposeContext } from '../email-compose/tests/capabilities';
import { useEmailThreadViewContext } from './context/email-thread-view-context';
import { EmailThread } from './email-thread';
import { createThreadContext, message, thread } from './tests/fixtures';
import { EmailParticipants } from './views/email-participants';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  clearDraft: vi.fn(),
  source: vi.fn(),
  composeOptions: vi.fn<(options: EmailComposeContextOptions) => void>(),
  started: [] as Promise<void>[],
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => <span /> }));
vi.mock('@app/features/email-message/components/email-user-tooltip', () => ({
  EmailUserTooltip: (props: ParentProps) => <>{props.children}</>,
}));
vi.mock('@property/tags', () => ({ InlineFetchedEntityTagsPill: () => null }));
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
const [linksLoaded, setLinksLoaded] = createSignal(true);
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    get isPending() {
      return !linksLoaded();
    },
    get isLoading() {
      return !linksLoaded();
    },
    get data() {
      return linksLoaded()
        ? {
            links: [
              { id: 'primary', email_address: 'viewer@example.com' },
              { id: 'inbox', email_address: 'viewer@outlook.example' },
            ],
          }
        : undefined;
    },
  }),
}));
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
vi.mock('./calendar-invitation', () => ({
  EmailCalendarInvitation: () => null,
}));
vi.mock('./thread-action-adapter', () => ({
  createThreadActionAdapter: vi.fn(),
}));
vi.mock('./views/email-thread', () => ({
  EmailThreadView: () => {
    const source = useEmailThreadViewContext().thread.source;
    mocks.source(source);
    return (
      <div>
        <EmailParticipants />
        <span data-testid="body">
          {source.thread()?.messages[0]?.body_text}
        </span>
        <button onClick={() => mocks.started.push(source.fetchOlder())}>
          Older
        </button>
        <button onClick={() => mocks.started.push(source.refresh())}>
          Refresh
        </button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  setLinksLoaded(true);
  vi.clearAllMocks();
  mocks.started.length = 0;
});

describe('email thread query ownership', () => {
  it('renders and observes the load gate source without starting another query', async () => {
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
    expect(mocks.source.mock.calls[0][0]).toMatchObject({
      id: source.id,
      fetchOlder,
      refresh,
    });
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
    await Promise.all(mocks.started);
  });

  it("labels the thread's inbox address, not the Macro login, as Me", () => {
    setLinksLoaded(false);
    const source = createThreadContext({
      thread: () =>
        thread([
          message('first', {
            from: { email: 'viewer@example.com' },
            to: [{ email: 'viewer@outlook.example' }],
          }),
        ]),
    }).source;
    render(() => (
      <EmailThread
        title="Subject"
        threadId={source.id}
        source={source}
        threadTransport={() => 'graphql'}
      />
    ));
    expect(screen.queryByText('Me')).toBeNull();
    setLinksLoaded(true);
    const participants = screen
      .getAllByRole('listitem')
      .map((node) => node.textContent)
      .filter(Boolean);
    expect(participants).toEqual(['viewer', 'Me']);
  });
});
