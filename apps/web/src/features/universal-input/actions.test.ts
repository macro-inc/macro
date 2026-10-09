import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInputActions } from './actions';
import { fieldsSchema, type Submission } from './core/input';

const mocks = vi.hoisted(() => ({
  agents: false,
  attachments: [] as object[],
  replace: vi.fn(),
  pending: vi.fn(),
  session: vi.fn(),
  history: vi.fn(),
  note: vi.fn(),
  task: vi.fn(),
  chat: vi.fn(),
  saveEmail: vi.fn(),
  sendEmail: vi.fn(),
  event: vi.fn(),
  dm: vi.fn(),
  group: vi.fn(),
  message: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.agents }),
}));
vi.mock('@core/constant/featureFlags', () => ({ enableChatV3Agents: {} }));
vi.mock('@core/auth', () => ({ useHasPaidAccess: () => () => false }));
vi.mock('@app/features/block-agent/context/pending-session', () => ({
  startPendingSession: mocks.session,
}));
vi.mock('@app/features/agents-view/queries/agent-roster-source', () => ({
  createAgentRosterSource: () => ({
    roster: () => [{ id: 'macro', kind: 'agent', name: 'Macro' }],
  }),
}));
vi.mock('@app/features/agents-view/queries/composer-models', () => ({
  createComposerModels: () => ({
    models: () => [],
    currentModel: () => undefined,
    pending: () => false,
  }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: mocks.replace } }),
}));
vi.mock('@core/component/AI/context', () => ({
  useChatInputContext: () => ({
    attachments: {
      attached: () => mocks.attachments,
      setAttached: (value: object[]) => {
        mocks.attachments = value;
      },
    },
  }),
}));
vi.mock('@core/component/AI/signal/pendingSend', () => ({
  setPendingSendData: mocks.pending,
}));
vi.mock('@app/features/home/queries/home-agent-prompt', () => ({
  buildHomeAgentPrompt: async ({ content }: { content: string }) => content,
}));
vi.mock('@core/signal/useCombinedRecipient', () => ({
  useCombinedRecipients: () => ({
    users: () => [
      {
        id: 'macro|john@example.com',
        kind: 'user',
        data: { name: 'John Adams', email: 'john@example.com' },
      },
    ],
    channels: () => [{ id: 'team-channel', data: { name: 'engineering' } }],
  }),
}));
vi.mock('@app/features/block-md/queries/create-document-with-tags', () => ({
  createDocumentWithTags: mocks.note,
}));
vi.mock('@app/features/block-md/util/taskComposerProperties', () => ({
  createTaskWithProperties: mocks.task,
  defaultTaskPropertyValues: () => ({}),
}));
vi.mock('@app/features/email-compose/compose-adapter', () => ({
  createEmailComposeContext: () => ({
    accounts: {
      inboxes: () => [{ id: 'inbox', email_address: 'me@example.com' }],
      primaryId: () => 'inbox',
    },
    drafts: { saveDraft: mocks.saveEmail },
    delivery: { sendMessage: mocks.sendEmail },
  }),
}));
vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () => ({
    isSuccess: true,
    data: [
      {
        id: 'calendar',
        isWritable: true,
        isPrimary: true,
        emailLinkId: 'inbox',
      },
    ],
  }),
}));
vi.mock('@queries/calendar/mutations', () => ({
  useCreateCalendarEventMutation: () => ({ mutateAsync: mocks.event }),
}));
vi.mock('@queries/channel/get-or-create-dm', () => ({
  useGetOrCreateDirectMessageMutation: () => ({ mutateAsync: mocks.dm }),
  useGetOrCreatePrivateChannelMutation: () => ({ mutateAsync: mocks.group }),
}));
vi.mock('@queries/messages/mutations', () => ({
  useSendMessageMutation: () => ({ mutateAsync: mocks.message }),
}));
vi.mock('@queries/history/history', () => ({
  useUpsertToHistoryMutation: () => ({ mutate: mocks.history }),
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: { createChat: mocks.chat },
}));
vi.mock('@app/features/calendar-view/calendar-navigation', () => ({
  calendarViewContent: (params: object) => ({
    type: 'component',
    id: 'calendar',
    params,
  }),
}));

function input(intent: Submission['intent'], values = {}): Submission {
  return {
    intent,
    id: 'retry-id',
    text: 'Original **Markdown**',
    fields: fieldsSchema.parse({
      title: 'Title',
      body: 'Hello John',
      subject: 'Subject',
      recipients: 'John',
      start: '2026-10-10T15:00',
      end: '2026-10-10T16:00',
      ...values,
    }),
  };
}
async function execute(snapshot: Submission) {
  return await createRoot(async (dispose) => {
    try {
      return await createInputActions(
        () => snapshot.fields,
        'macro|me@example.com'
      ).submit(snapshot);
    } finally {
      dispose();
    }
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.agents = false;
  mocks.attachments = [];
  mocks.note.mockResolvedValue({ documentId: 'note' });
  mocks.task.mockResolvedValue({ documentId: 'task' });
  mocks.chat.mockResolvedValue(ok({ id: 'chat' }));
  mocks.session.mockReturnValue('session');
  mocks.saveEmail.mockResolvedValue({
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
  });
  mocks.sendEmail.mockResolvedValue({ threadId: 'thread', inboxId: 'inbox' });
  mocks.event.mockResolvedValue({ id: 'event' });
  mocks.dm.mockResolvedValue({ channel_id: 'dm' });
  mocks.message.mockResolvedValue({ id: 'message' });
});

describe('destination adapters', () => {
  it('starts legacy AI with the original text and attachments', async () => {
    await execute(input('ai'));
    expect(mocks.pending).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Original **Markdown**' })
    );
    expect(mocks.replace).toHaveBeenCalledWith({
      next: { type: 'chat', id: 'chat' },
    });
  });
  it('starts the existing agent session when enabled', async () => {
    mocks.agents = true;
    await execute(input('ai'));
    expect(mocks.session).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Original **Markdown**',
        submitSurface: 'home',
      })
    );
    expect(mocks.chat).not.toHaveBeenCalled();
  });
  it('opens global search with the extracted query', async () => {
    await execute(input('search', { query: 'quarterly budget' }));
    expect(mocks.replace).toHaveBeenCalledWith({
      next: expect.objectContaining({
        id: 'search',
        preserveParams: true,
        params: { initialQuery: 'quarterly budget' },
      }),
    });
  });
  it('preserves complete Markdown in notes', async () => {
    const result = await execute(input('note'));
    expect(mocks.note.mock.calls[0].slice(0, 2)).toEqual([
      'Title',
      'Original **Markdown**',
    ]);
    result.open?.();
    expect(mocks.replace).toHaveBeenCalledWith({
      next: { type: 'md', id: 'note' },
    });
  });
  it('creates tasks through the shared property-aware mutation', async () => {
    await execute(input('task', { due_date: '2026-10-12' }));
    expect(mocks.task.mock.calls[0].slice(0, 2)).toEqual([
      'Title',
      'Hello John',
    ]);
    expect(mocks.task.mock.calls[0][2]).toEqual([
      expect.arrayContaining([expect.objectContaining({ valueType: 'DATE' })]),
    ]);
  });
  it('saves then sends email through the shared delivery lifecycle', async () => {
    await execute(input('email'));
    expect(mocks.saveEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxId: 'inbox',
        draft: expect.objectContaining({
          body_text: 'Hello John',
          to: [{ email: 'john@example.com', name: 'John Adams' }],
        }),
      })
    );
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxId: 'inbox',
        message: expect.objectContaining({
          db_id: 'draft',
          thread_db_id: 'thread',
        }),
      })
    );
  });
  it('creates a timed event with retry identity and no inferred invitation', async () => {
    await execute(input('calendar'));
    expect(mocks.event).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'calendar',
        idempotencyKey: 'retry-id',
        attendees: [],
        time: expect.objectContaining({
          startsAt: new Date('2026-10-10T15:00').toISOString(),
          endsAt: new Date('2026-10-10T16:00').toISOString(),
        }),
      })
    );
  });
  it('resolves a DM only at submission and keeps the message retry ID', async () => {
    await execute(input('message'));
    expect(mocks.dm).toHaveBeenCalledWith({
      recipient_id: 'macro|john@example.com',
    });
    expect(mocks.message).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { type: 'channel', id: 'dm' },
        optimisticId: 'retry-id',
        message: { content: 'Hello John' },
      })
    );
  });
  it('posts to an existing channel without creating a DM', async () => {
    await execute(input('message', { recipients: '#engineering' }));
    expect(mocks.dm).not.toHaveBeenCalled();
    expect(mocks.message).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { type: 'channel', id: 'team-channel' },
      })
    );
  });
  it('blocks unknown message recipients and unsupported attachments', async () => {
    await expect(
      execute(input('message', { recipients: 'Unknown' }))
    ).rejects.toThrow('specific recipient');
    mocks.attachments = [{}];
    await expect(execute(input('note'))).rejects.toThrow('Attached context');
    expect(mocks.note).not.toHaveBeenCalled();
    expect(mocks.message).not.toHaveBeenCalled();
  });
});
