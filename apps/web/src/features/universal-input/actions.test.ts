import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { PropertyApiValues } from '@property/types';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeBase64Utf8 } from '../email-compose/core/decode-base64';
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
  taskSnapshot: vi.fn(),
  taskValues: {} as Record<string, PropertyApiValues>,
  taskDefinitions: new Map<string, PropertyDefinition>(),
  chat: vi.fn(),
  saveEmail: vi.fn(),
  sendEmail: vi.fn(),
  connectGoogle: vi.fn(),
  event: vi.fn(),
  dm: vi.fn(),
  group: vi.fn(),
  message: vi.fn(),
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({
    openWithSplit: (content: unknown) => mocks.replace({ next: content }),
  }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.agents }),
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  enableChatV3Agents: {},
  enableProjects: {},
}));
vi.mock('@property/tags', () => ({ useLocalDocTags: vi.fn() }));
vi.mock('@queries/properties/definitions', () => ({}));
vi.mock('@queries/properties/tags', () => ({}));
vi.mock('@queries/properties/entity', () => ({
  fetchEntityProperties: vi.fn(),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('@app/features/block-md/util/documentComposerProperties', () => ({
  createDocumentComposerTags: () => ({
    composerTags: {},
    createDefinitions: () => new Map(),
  }),
}));
vi.mock('@core/auth', () => ({ useHasPaidAccess: () => () => false }));
vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => mocks.connectGoogle,
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
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
vi.mock('@app/features/agents-view/queries/composer-prompt', () => ({
  buildAgentPrompt: async ({ content }: { content: string }) => content,
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => ({
      items: () => [
        { id: 'team-channel', data: { name: 'engineering' } },
        { id: 'julia-dm', data: { name: 'Julia direct message' } },
      ],
    }),
  }),
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
    channels: () => [
      { kind: 'channel', id: 'team-channel', data: { name: 'engineering' } },
    ],
  }),
}));
vi.mock('@app/features/block-md/queries/create-document-with-tags', () => ({
  createDocumentWithTags: mocks.note,
}));
vi.mock('@app/features/block-md/util/taskComposerProperties', () => ({
  createTaskWithProperties: mocks.task,
  defaultTaskPropertyValues: () => ({}),
}));
vi.mock('./queries/task-field-source', () => ({
  createTaskFieldSource: () => ({
    definitions: async () => [],
    createDefinitions: async () => mocks.taskDefinitions,
    values: () => ({ values: mocks.taskValues, unresolved: [] }),
  }),
}));
vi.mock('@core/util/create', () => ({
  createTaskWithInitialSnapshot: mocks.taskSnapshot,
}));
vi.mock('@app/features/email-compose/compose-adapter', () => ({
  createEmailComposeContext: () => ({
    accounts: {
      inboxes: () => [{ id: 'inbox', email_address: 'me@example.com' }],
      primaryId: () => 'inbox',
      loading: () => false,
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
        'macro|me@example.com',
        { navigate: (next) => mocks.replace({ next }) }
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
  mocks.taskSnapshot.mockResolvedValue({ documentId: 'task' });
  mocks.taskValues = {};
  mocks.taskDefinitions = new Map();
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
  it('requests Gmail and calendar consent for the selected Google account', async () => {
    await createRoot(async (dispose) => {
      try {
        await createInputActions(
          () => input('email').fields,
          'macro|me@example.com',
          { navigate: (next) => mocks.replace({ next }) }
        ).connectGoogle();
        expect(mocks.connectGoogle).toHaveBeenCalledWith({
          scopes: 'gmail_and_calendar',
          emailAddress: 'me@example.com',
        });
      } finally {
        dispose();
      }
    });
  });
  it('starts legacy AI with the original text and attachments', async () => {
    const result = await execute(input('ai'));
    expect(mocks.pending).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Original **Markdown**' })
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    result.open?.();
    expect(mocks.replace).toHaveBeenCalledWith({
      next: { type: 'chat', id: 'chat' },
    });
  });
  it('starts the existing agent session when enabled', async () => {
    mocks.agents = true;
    const result = await execute(input('ai'));
    expect(mocks.session).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Original **Markdown**',
        submitSurface: 'other',
      })
    );
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    result.open?.();
    expect(mocks.replace).toHaveBeenCalledOnce();
  });
  it('opens global search with the extracted query', async () => {
    const result = await execute(
      input('search', { query: 'quarterly budget' })
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    result.open?.();
    expect(mocks.replace).toHaveBeenCalledWith({
      next: expect.objectContaining({
        id: 'search',
        preserveParams: true,
        params: expect.objectContaining({ initialQuery: 'quarterly budget' }),
      }),
    });
  });
  it('resolves an extracted email inbox during validation and submission', async () => {
    const snapshot = input('search', {
      query: 'budget',
      searchFilters: JSON.stringify({
        type: 'email',
        email: { inboxIds: ['me@example.com'], importance: false },
      }),
    });
    const result = await execute(snapshot);
    result.open?.();
    expect(mocks.replace).toHaveBeenCalledWith({
      next: expect.objectContaining({
        params: expect.objectContaining({
          initialFilters: expect.objectContaining({
            include: expect.objectContaining({
              emailLinkId: ['inbox'],
              emailImportance: false,
            }),
          }),
        }),
      }),
    });
    await expect(
      execute(
        input('search', {
          query: 'budget',
          searchFilters: JSON.stringify({
            type: 'email',
            email: { inboxIds: ['missing@example.com'] },
          }),
        })
      )
    ).rejects.toThrow();
  });
  it('opens global search with resolved sender and DM filters rather than dropping them', async () => {
    const searchFilters = JSON.stringify({
      type: 'channels',
      channels: { in: ['julia-dm'], from: ['John'] },
    });
    const result = await execute(
      input('search', { query: 'budget', searchFilters })
    );
    result.open?.();
    expect(mocks.replace).toHaveBeenCalledWith({
      next: expect.objectContaining({
        id: 'search',
        params: expect.objectContaining({
          initialQuery: 'budget',
          initialFilters: expect.objectContaining({
            include: expect.objectContaining({
              channelSenderId: ['macro|john@example.com'],
              channelId: ['julia-dm'],
            }),
          }),
        }),
      }),
    });
  });
  it('requires keywords for sender-only message search instead of falling back to unfiltered channels', async () => {
    await expect(
      execute(
        input('search', {
          query: '',
          searchFilters: JSON.stringify({
            type: 'channels',
            channels: { in: [], from: ['John'] },
          }),
        })
      )
    ).rejects.toThrow('Add at least 3 search characters');
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it('saves the visible event description through the existing calendar API', async () => {
    await execute(input('calendar', { body: 'Discuss the launch plan' }));
    expect(mocks.event).toHaveBeenCalledWith(
      expect.objectContaining({ description: '<p>Discuss the launch plan</p>' })
    );
  });
  it('preserves complete Markdown in notes', async () => {
    const result = await execute(
      input('note', { body: 'Original **Markdown**' })
    );
    expect(mocks.note.mock.calls[0].slice(0, 2)).toEqual([
      'Title',
      'Original **Markdown**',
    ]);
    result.open?.();
    expect(mocks.replace).toHaveBeenCalledWith({
      next: { type: 'md', id: 'note' },
    });
  });
  it.each(['# Reviewed note\n\n- Keep **this** detail', ''])(
    'creates a note from the visible body %j instead of the source draft',
    async (body) => {
      await execute(input('note', { body }));
      expect(mocks.note.mock.calls[0].slice(0, 2)).toEqual(['Title', body]);
    }
  );
  it('creates tasks through the shared property-aware mutation', async () => {
    mocks.taskValues = {
      [SYSTEM_PROPERTY_IDS.DUE_DATE]: {
        valueType: 'DATE',
        value: new Date('2026-10-12T12:00:00'),
      },
    };
    await execute(input('task', { due_date: '2026-10-12' }));
    expect(mocks.task.mock.calls[0].slice(0, 2)).toEqual([
      'Title',
      'Hello John',
    ]);
    expect(mocks.task.mock.calls[0][2]).toEqual([
      expect.arrayContaining([expect.objectContaining({ valueType: 'DATE' })]),
    ]);
  });
  it.each([{ ids: ['julia'] }, { ids: ['julia', 'alex'] }])(
    'preserves all selected assignees in the final task creation payload: $ids',
    async ({ ids }) => {
      const refs = ids.map((entity_id) => ({
        entity_id,
        entity_type: 'USER' as const,
      }));
      mocks.taskValues = {
        [SYSTEM_PROPERTY_IDS.ASSIGNEES]: { valueType: 'ENTITY', refs },
      };
      mocks.taskDefinitions.set(SYSTEM_PROPERTY_IDS.ASSIGNEES, {
        id: SYSTEM_PROPERTY_IDS.ASSIGNEES,
        display_name: 'Assignees',
        data_type: 'ENTITY',
        is_multi_select: true,
        specific_entity_type: 'USER',
        is_metadata: false,
        is_system: true,
        owner: { scope: 'system' },
        created_at: '',
        updated_at: '',
      });
      const real = await vi.importActual<
        typeof import('@app/features/block-md/util/taskComposerProperties')
      >('@app/features/block-md/util/taskComposerProperties');
      mocks.task.mockImplementationOnce(real.createTaskWithProperties);
      await execute(input('task'));
      expect(mocks.taskSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          propertyValues: [
            {
              propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
              value: { type: 'multi_entity_reference', references: refs },
            },
          ],
        })
      );
    }
  );
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
  it('explicitly saves an unfinished email through the shared draft adapter without delivery', async () => {
    await createRoot(async (dispose) => {
      try {
        const submission = input('email', {
          recipients: '',
          subject: '',
          body: 'Still thinking…',
        });
        const actions = createInputActions(
          () => submission.fields,
          'macro|me@example.com',
          { navigate: (next) => mocks.replace({ next }) }
        );
        expect(mocks.saveEmail).not.toHaveBeenCalled();
        expect(actions.validateEmailDraft(submission)).toBeUndefined();
        const result = await actions.saveEmailDraft(submission);
        expect(mocks.saveEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            inboxId: 'inbox',
            draft: expect.objectContaining({
              subject: '',
              to: [],
              body_text: 'Still thinking…',
            }),
          })
        );
        expect(mocks.sendEmail).not.toHaveBeenCalled();
        expect(result.message).toBe('Email draft saved');
        result.open?.();
        expect(mocks.replace).toHaveBeenCalledWith({
          next: { type: 'email', id: 'thread' },
        });
      } finally {
        dispose();
      }
    });
  });
  it('sends escaped HTML with Unicode and line breaks matching the visible body', async () => {
    const body = 'Hi José 👋\nBring <notes> & coffee';
    await execute(input('email', { body }));
    const draft = mocks.saveEmail.mock.calls[0][0].draft;
    const html = decodeBase64Utf8(draft.body_html);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.body.textContent).toBe('Hi José 👋Bring <notes> & coffee');
    expect(parsed.querySelector('br')).not.toBeNull();
    expect(parsed.querySelector('notes')).toBeNull();
    expect(draft.body_text).toBe(body);
    expect(mocks.sendEmail.mock.calls[0][0].message.body_html).toBe(
      draft.body_html
    );
  });
  it('sends the shared editor’s rich HTML through the existing email preparation pipeline', async () => {
    const editor = createEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createTextNode('Hello José').toggleFormat('bold')
          )
        );
      },
      { discrete: true }
    );
    await createRoot(async (dispose) => {
      try {
        const submission = input('email', { body: '**Hello José**' });
        const actions = createInputActions(
          () => submission.fields,
          'macro|me@example.com',
          { navigate: (next) => mocks.replace({ next }) }
        );
        actions.captureEmailEditor(editor);
        await actions.submit(submission);
        const draft = mocks.saveEmail.mock.calls[0][0].draft;
        const parsed = new DOMParser().parseFromString(
          decodeBase64Utf8(draft.body_html),
          'text/html'
        );
        expect(parsed.querySelector('strong, b')?.textContent).toBe(
          'Hello José'
        );
        expect(draft.body_text).toBe('Hello José');
        expect(draft.body_macro).toBe('**Hello José**');
      } finally {
        dispose();
      }
    });
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
        message: { content: 'Hello John', mentions: [] },
      })
    );
  });
  it('preserves authored mentions using the channel payload adapter', async () => {
    const snapshot = input('message');
    await createRoot(async (dispose) => {
      try {
        const actions = createInputActions(
          () => snapshot.fields,
          'macro|me@example.com',
          { navigate: (next) => mocks.replace({ next }) }
        );
        actions.captureMessageMentions(() => [
          { itemType: 'user', itemId: 'macro|john@example.com' },
        ]);
        await actions.submit(snapshot);
      } finally {
        dispose();
      }
    });
    expect(mocks.message).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          content: 'Hello John',
          mentions: [
            { entity_type: 'user', entity_id: 'macro|john@example.com' },
          ],
        },
      })
    );
  });
  it('saves selected note tags alongside the visible body', async () => {
    await execute(
      input('note', {
        noteTags: JSON.stringify({
          'tag-definition': {
            valueType: 'SELECT_STRING',
            values: ['tag-option'],
          },
        }),
      })
    );
    expect(mocks.note).toHaveBeenCalledWith(
      'Title',
      'Hello John',
      [
        [
          'tag-definition',
          { valueType: 'SELECT_STRING', values: ['tag-option'] },
        ],
      ],
      expect.any(Map),
      expect.any(Function)
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
  it.each(['', '   ', ', ;\n,'])(
    'blocks empty message addressing %j',
    async (recipients) => {
      await expect(execute(input('message', { recipients }))).rejects.toThrow(
        'Choose at least one recipient'
      );
      expect(mocks.dm).not.toHaveBeenCalled();
      expect(mocks.group).not.toHaveBeenCalled();
      expect(mocks.message).not.toHaveBeenCalled();
    }
  );
});
