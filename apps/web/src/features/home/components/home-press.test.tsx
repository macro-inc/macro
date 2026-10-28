import type { ChannelThreadEntity, WithNotification } from '@entity';
import type { UnifiedNotification } from '@notifications/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeListEntity } from './HomeListEntity';

vi.mock('@app/features/agents-view/views/AgentSessionListItem', () => ({
  AgentSessionListItem: () => null,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'test-user' }));
vi.mock('@core/user', () => ({
  getDisplayName: (id: string) =>
    id === 'macro|teo@macro.com'
      ? 'Teo'
      : id === 'macro|eric.hayes@macro.com'
        ? 'Eric'
        : 'Peter',
  tryMacroId: (id: string) => id,
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: { CloseButton: () => null },
}));

vi.mock('@entity', () => ({
  Entity: { Title: () => 'Recent chat', Timestamp: () => 'now' },
  MaybeEntityRow: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ mutedEntities: () => [] }),
}));
vi.mock('./HomeEntityIcon', () => ({ HomeEntityIcon: () => null }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/utils/press')),
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

afterEach(cleanup);

describe('Home channel reply row', () => {
  const replyNotification = (
    senderId: string | null,
    senderDisplayName: string | null = null
  ): UnifiedNotification => ({
    id: 'reply-notification',
    entity_id: 'bug-reports',
    entity_type: 'channel',
    sender_id: senderId,
    state: 'seen',
    created_at: '2026-10-01T16:34:48Z',
    updated_at: '2026-10-01T16:34:48Z',
    sent: true,
    viewed_at: null,
    notification_event_type: 'channel_message_reply',
    notification_metadata: {
      tag: 'channel_message_reply',
      content: {
        messageId: 'reply',
        messageContent: 'Reply to Peter',
        threadId: 'root',
        channelType: 'private',
        senderDisplayName,
        threadParentSenderId: 'macro|peter@macro.com',
      },
    },
  });

  const renderThread = (
    initial: UnifiedNotification[] = [],
    senderId = 'macro|peter@macro.com'
  ) => {
    const [notifications, setNotifications] = createSignal(initial);
    const entity: WithNotification<ChannelThreadEntity> = {
      type: 'channel_thread',
      id: 'root',
      name: 'bug-reports',
      ownerId: senderId,
      channelId: 'bug-reports',
      channelType: 'private',
      messageId: 'root',
      threadId: 'root',
      senderId,
      sender: { id: senderId, type: 'user' },
      content: 'calendar invite has raw html',
      attachments: [],
      reactions: [],
      thread: { replyCount: 2, preview: [] },
      notifications,
    };
    const view = render(() => (
      <HomeListEntity entity={entity} occurrenceKey="root" />
    ));
    const row = view.container.querySelector<HTMLElement>('[data-home-item]')!;
    return { row, setNotifications };
  };

  it('updates the sender from a human reply to a bot reply', () => {
    const { row, setNotifications } = renderThread([
      replyNotification('macro|teo@macro.com'),
    ]);
    expect(row.textContent).toContain('Teo in #bug-reports');

    setNotifications([
      replyNotification(null, 'Codex'),
      replyNotification('macro|teo@macro.com'),
    ]);
    expect(row.textContent).toContain('Codex in #bug-reports');
    expect(row.textContent).not.toContain('Peter');
  });

  it.each([
    { senderId: 'macro|teo@macro.com', displayName: null, label: 'Teo' },
    { senderId: null, displayName: 'Codex', label: 'Codex' },
    { senderId: 'test-user', displayName: null, label: 'You' },
    { senderId: null, displayName: null, label: 'Someone' },
  ])(
    'names the mention sender as $label when a mention follows a reply',
    ({ senderId, displayName, label }) => {
      const previousReply = replyNotification('macro|peter@macro.com');
      const { row, setNotifications } = renderThread([previousReply]);
      expect(row.textContent).toContain('Peter in #bug-reports');

      setNotifications([
        {
          ...replyNotification(senderId),
          id: 'mention-notification',
          created_at: '2026-10-01T16:35:48Z',
          updated_at: '2026-10-01T16:35:48Z',
          notification_event_type: 'channel_mention',
          notification_metadata: {
            tag: 'channel_mention',
            content: {
              messageId: 'mention',
              messageContent: '@test-user',
              threadId: 'root',
              channelType: 'private',
              senderDisplayName: displayName,
            },
          },
        },
        previousReply,
      ]);

      expect(row.textContent).toContain(`${label} in #bug-reports`);
      expect(row.textContent).not.toContain('Peter');
    }
  );

  it('uses the thread author when there is no notification', () => {
    expect(renderThread().row.textContent).toContain('Peter in #bug-reports');
  });

  it('keeps the reply sender when the same message also mentions a document', () => {
    const reply = replyNotification('macro|eric.hayes@macro.com');
    const { row, setNotifications } = renderThread([reply], 'test-user');
    expect(row.textContent).toContain('Eric in #bug-reports');

    const documentMention: UnifiedNotification = {
      ...reply,
      id: 'document-mention',
      created_at: '2026-10-01T16:34:48.028Z',
      updated_at: '2026-10-01T16:34:48.028Z',
      notification_event_type: 'document_mention',
      notification_metadata: {
        tag: 'document_mention',
        content: {
          messageId: 'reply',
          messageContent: 'Reply with a document mention',
          threadId: 'root',
          channelType: 'private',
          documentName: 'Owners',
          owner: 'macro|teo@macro.com',
          fileType: 'md',
          subType: null,
          senderDisplayName: null,
        },
      },
    };
    setNotifications([documentMention, reply]);
    expect(row.textContent).toContain('Eric in #bug-reports');
    expect(row.textContent).not.toContain('You in');

    setNotifications([{ ...documentMention, state: 'done' }, reply]);
    expect(row.textContent).toContain('Eric in #bug-reports');

    setNotifications([
      replyNotification(null, 'Macro'),
      documentMention,
      reply,
    ]);
    expect(row.textContent).toContain('Macro in #bug-reports');
  });

  it('does not attribute an unnamed bot reply to the thread author', () => {
    expect(renderThread([replyNotification(null)]).row.textContent).toContain(
      'Someone in #bug-reports'
    );
  });

  it('keeps the current user label for human replies', () => {
    expect(
      renderThread([replyNotification('test-user')]).row.textContent
    ).toContain('You in #bug-reports');
  });
});

describe('Home recent press', () => {
  function setup() {
    const activate = vi.fn();
    const view = render(() => (
      <HomeListEntity
        entity={{
          type: 'chat',
          id: 'recent-chat',
          name: 'Recent chat',
          ownerId: 'test-user',
        }}
        occurrenceKey="recent-chat"
        onClick={activate}
      />
    ));
    const item = view.container.querySelector<HTMLElement>('[data-home-item]')!;
    return { activate, item };
  }

  it('activates on primary press exactly once and preserves modifiers', () => {
    const { activate, item } = setup();
    fireEvent.mouseDown(item, { button: 0, detail: 1, ctrlKey: true });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate.mock.calls[0][0].ctrlKey).toBe(true);
    fireEvent.mouseUp(item, { button: 0, detail: 1 });
    fireEvent.click(item, { button: 0, detail: 1 });
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard and click-only activation', () => {
    const { activate, item } = setup();
    fireEvent.click(item, { button: 0, detail: 0 });
    fireEvent.click(item, { button: 0, detail: 1 });
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it('ignores secondary presses', () => {
    const { activate, item } = setup();
    fireEvent.mouseDown(item, { button: 2 });
    fireEvent.click(item, { button: 2 });
    expect(activate).not.toHaveBeenCalled();
  });
});

describe('Home document comment row', () => {
  const commentNotification = (state: 'unseen' | 'seen' | 'done') => ({
    id: 'n1',
    entity_id: 'doc-1',
    entity_type: 'document',
    sender_id: 'macro|peter@macro.com',
    state,
    created_at: '2026-09-23T00:00:00Z',
    notification_metadata: {
      tag: 'mentioned_in_document_comment',
      content: { commentId: 'comment-1', documentName: 'Plan' },
    },
  });

  const renderRow = (
    state: 'unseen' | 'seen' | 'done',
    notificationDisplayCutoff?: string
  ) =>
    render(() => (
      <HomeListEntity
        entity={
          {
            type: 'document',
            id: 'doc-1',
            name: 'Plan',
            ownerId: 'test-user',
            fileType: 'md',
            notificationDisplayCutoff,
            notifications: () => [commentNotification(state)],
          } as never
        }
        occurrenceKey="doc-1"
      />
    )).container.querySelector<HTMLElement>('[data-home-item]')!;

  it.each(['unseen', 'seen'] as const)(
    'announces the comment mention while %s',
    (state) => {
      expect(renderRow(state).textContent).toContain(
        'Peter mentioned you on Recent chat'
      );
    }
  );

  it('reads as the plain document once the notification is done', () => {
    expect(renderRow('done').textContent).not.toContain('mentioned you');
  });

  it.each(['unseen', 'seen'] as const)(
    'shows the task instead of an older %s comment after newer activity',
    (state) => {
      const row = renderRow(state, '2026-10-01T17:02:49Z');
      expect(row.textContent).toContain('Recent chat');
      expect(row.textContent).not.toContain('Peter mentioned');
      expect(row.querySelector('[aria-label="Unread"]') !== null).toBe(
        state === 'unseen'
      );
    }
  );

  it('announces a comment that supplied the row timestamp', () => {
    expect(renderRow('seen', '2026-09-23T00:00:00Z').textContent).toContain(
      'Peter mentioned you on Recent chat'
    );
  });

  it('names the agent that replied instead of someone', () => {
    const row = render(() => (
      <HomeListEntity
        entity={
          {
            type: 'document',
            id: 'doc-1',
            name: 'Plan',
            ownerId: 'test-user',
            fileType: 'md',
            notifications: () => [
              {
                ...commentNotification('unseen'),
                sender_id: null,
                notification_metadata: {
                  tag: 'replied_to_document_comment_thread',
                  content: {
                    commentId: 'comment-1',
                    documentName: 'Plan',
                    senderDisplayName: 'Macro',
                  },
                },
              },
            ],
          } as never
        }
        occurrenceKey="doc-1"
      />
    )).container.querySelector<HTMLElement>('[data-home-item]')!;

    expect(row.textContent).toContain('Macro replied on Recent chat');
    expect(row.textContent).not.toContain('Someone');
  });
});

describe('Home calendar join request row', () => {
  const joinRequest = (
    overrides: Partial<UnifiedNotification> = {}
  ): UnifiedNotification => ({
    id: 'join-request',
    entity_id: 'event-1',
    entity_type: 'calendar_event',
    sender_id: 'macro|teo@macro.com',
    state: 'unseen',
    created_at: '2026-10-23T17:21:50Z',
    updated_at: '2026-10-23T17:21:50Z',
    sent: true,
    viewed_at: null,
    notification_event_type: 'calendar_event_join_request',
    notification_metadata: {
      tag: 'calendar_event_join_request',
      content: { eventId: 'event-1', requestId: 'request-1', title: 'Sync' },
    },
    ...overrides,
  });
  const reminder: UnifiedNotification = {
    ...joinRequest(),
    id: 'reminder',
    sender_id: null,
    created_at: '2026-10-23T17:30:00Z',
    updated_at: '2026-10-23T17:30:00Z',
    notification_event_type: 'calendar_event_reminder',
    notification_metadata: {
      tag: 'calendar_event_reminder',
      content: {
        eventId: 'event-1',
        occurrenceKey: '2026-10-23T18:00:00Z',
        title: 'Sync',
        startsAt: '2026-10-23T18:00:00Z',
        endsAt: '2026-10-23T18:30:00Z',
        startDate: null,
        timeZone: null,
        minutesBefore: 30,
      },
    },
  } as UnifiedNotification;

  const renderEvent = (
    initial: UnifiedNotification[],
    notificationDisplayCutoff?: string
  ) => {
    const [notifications, setNotifications] = createSignal(initial);
    const view = render(() => (
      <HomeListEntity
        entity={
          {
            type: 'calendar_event',
            id: 'event-1',
            name: 'Sync',
            ownerId: 'test-user',
            status: 'confirmed',
            isReadOnly: false,
            notifications,
            notificationDisplayCutoff,
          } as never
        }
        occurrenceKey="event-1"
      />
    ));
    const row = view.container.querySelector<HTMLElement>('[data-home-item]')!;
    return { row, setNotifications };
  };

  it('says who asked to join', () => {
    const { row } = renderEvent([joinRequest()]);
    expect(row.textContent).toContain('Teo asked to join Recent chat');
  });

  it('keeps the plain title when the newest outstanding notification is not a request', () => {
    const { row, setNotifications } = renderEvent([reminder, joinRequest()]);
    expect(row.textContent).not.toContain('asked to join');

    setNotifications([joinRequest({ state: 'done' })]);
    expect(row.textContent).not.toContain('asked to join');

    setNotifications([joinRequest()]);
    expect(row.textContent).toContain('Teo asked to join Recent chat');
  });

  it('does not let newer own activity borrow an older request', () => {
    const { row } = renderEvent([joinRequest()], '2026-10-23T18:00:00Z');
    expect(row.textContent).not.toContain('asked to join');
  });
});
