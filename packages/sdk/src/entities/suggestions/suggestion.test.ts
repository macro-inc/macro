import { describe, expect, test } from 'bun:test';
import type { Suggestion as SuggestionRecord } from '../../../generated/scheduled-action/types.gen';
import type { MacroClient } from '../../utils/client';
import { EmailDraft } from '../email/draft';
import { EmailThread } from '../email/thread';
import { SuggestionNamespace } from './namespace';
import { Suggestion } from './suggestion';

const REPLY_SUGGESTION: SuggestionRecord = {
  id: 'suggestion',
  kind: 'entity',
  action: 'reply',
  draft: { entityType: 'email_thread', entityId: 'thread', partId: 'draft' },
  dedupKey: 'thread:thread:reply',
  title: 'Reply to the venue',
  summary: 'They asked for a headcount by Friday.',
  importance: 80,
  categories: ['important'],
  state: 'proposed',
  status: 'open',
  about: [{ entityType: 'email_thread', entityId: 'thread' }],
  produced: [],
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
  stateChangedAt: '2026-11-09T00:00:00Z',
};

describe('Suggestion drafts', () => {
  test('attachDraft sends the draft handle as its id, with the reason', async () => {
    const requests: unknown[] = [];
    const client = {
      scheduledAction: {
        attachSuggestionDraft: async (request: unknown) => {
          requests.push(request);
          return {
            data: { ok: true, problems: [], suggestion: REPLY_SUGGESTION },
          };
        },
      },
    } as unknown as MacroClient;
    const suggestion = Suggestion.from(client, REPLY_SUGGESTION);

    const outcome = await suggestion.attachDraft(
      EmailDraft.byId(client, 'draft'),
      'Drafted the headcount reply',
    );

    expect(requests).toEqual([
      {
        path: { id: 'suggestion' },
        body: { emailDraftId: 'draft', reason: 'Drafted the headcount reply' },
      },
    ]);
    expect(outcome.ok).toBe(true);
    expect(outcome.suggestion?.draft?.id).toBe('draft');
  });

  test('a reply suggestion names its draft as a handle; other suggestions have none', () => {
    const client = {} as MacroClient;
    expect(Suggestion.from(client, REPLY_SUGGESTION).draft).toBeInstanceOf(
      EmailDraft,
    );
    expect(
      Suggestion.from(client, { ...REPLY_SUGGESTION, draft: null }).draft,
    ).toBeUndefined();
  });

  test("a thread's drafts are its unsent drafts", async () => {
    const message = (id: string, isDraft: boolean, isSent: boolean) => ({
      db_id: id,
      is_draft: isDraft,
      is_sent: isSent,
      attachments: [],
    });
    const client = {
      email: {
        getThread: async () => ({
          data: {
            thread: {
              messages: [
                message('received', false, false),
                message('sent', false, true),
                message('draft', true, false),
              ],
            },
          },
        }),
      },
    } as unknown as MacroClient;

    const drafts = await EmailThread.byId(client, 'thread').drafts();

    expect(drafts.map((draft) => draft.id)).toEqual(['draft']);
    expect(drafts[0]).toBeInstanceOf(EmailDraft);
  });
});

describe('Suggestion accept', () => {
  test('accept sends the suggestion as it was read', async () => {
    const requests: unknown[] = [];
    const client = {
      scheduledAction: {
        acceptSuggestion: async (request: unknown) => {
          requests.push(request);
          return { data: undefined };
        },
      },
    } as unknown as MacroClient;

    await Suggestion.from(client, REPLY_SUGGESTION).accept();

    expect(requests).toEqual([
      {
        path: { id: 'suggestion' },
        body: { updatedAt: '2026-11-09T00:00:00Z' },
      },
    ]);
  });
});

describe('Suggestion list', () => {
  const DONE_SUGGESTION: SuggestionRecord = {
    ...REPLY_SUGGESTION,
    id: 'done',
    state: 'done',
    status: 'done',
  };

  const COUNTS = { open: 1, running: 0, failed: 0, done: 1 };

  function feedClient(requests: unknown[]): MacroClient {
    return {
      scheduledAction: {
        listSuggestions: async (request: { query?: { limit?: number } }) => {
          requests.push(request);
          // The feed leaves out the done list when read with a limit.
          const done = request.query?.limit ? undefined : [DONE_SUGGESTION];
          return {
            data: { suggestions: [REPLY_SUGGESTION], done, counts: COUNTS },
          };
        },
      },
    } as unknown as MacroClient;
  }

  test('list returns the open suggestions, then the done ones, with their status', async () => {
    const requests: unknown[] = [];
    const suggestions = await new SuggestionNamespace(
      feedClient(requests),
    ).list();

    expect(
      suggestions.map((suggestion) => [suggestion.id, suggestion.status]),
    ).toEqual([
      ['suggestion', 'open'],
      ['done', 'done'],
    ]);
    expect(requests).toEqual([
      { query: { timezone: undefined, limit: undefined } },
    ]);
  });

  test('list sends the time zone and limit it is given, and refuses other options', async () => {
    const requests: unknown[] = [];
    const namespace = new SuggestionNamespace(feedClient(requests));

    const limited = await namespace.list({
      timezone: 'Europe/Paris',
      limit: 5,
    });

    expect(limited.map((suggestion) => suggestion.id)).toEqual(['suggestion']);

    expect(requests).toEqual([
      { query: { timezone: 'Europe/Paris', limit: 5 } },
    ]);
    await expect(
      namespace.list({ timeZone: 'Europe/Paris' } as never),
    ).rejects.toThrow('suggestions.list does not take `timeZone`');
  });
});

describe('Suggestion facts', () => {
  test('a reply suggestion shows who it waits on and its draft preview', () => {
    const suggestion = Suggestion.from({} as MacroClient, {
      ...REPLY_SUGGESTION,
      kind: 'entity',
      action: 'reply',
      waitingSince: '2026-11-08T09:00:00Z',
      from: 'Ada Lovelace',
      draft: {
        entityType: 'email_thread',
        entityId: 'thread',
        partId: 'draft',
        preview: 'Thanks, see you Monday',
      },
    });

    expect(suggestion.waitingSince).toBe('2026-11-08T09:00:00Z');
    expect(suggestion.from).toBe('Ada Lovelace');
    expect(suggestion.draftPreview).toBe('Thanks, see you Monday');
    expect(Suggestion.from({} as MacroClient, REPLY_SUGGESTION).from).toBe(
      undefined,
    );
  });

  test('a settled suggestion names its result as a handle', () => {
    const client = {} as MacroClient;
    const done = Suggestion.from(client, {
      ...REPLY_SUGGESTION,
      state: 'done',
      status: 'done',
      result: { entityType: 'email_thread', entityId: 'thread' },
    });

    expect(done.result?.type).toBe('email_thread');
    expect(done.result?.entity).toBeInstanceOf(EmailThread);
    expect(done.result?.entity.id).toBe('thread');
    expect(Suggestion.from(client, REPLY_SUGGESTION).result).toBeUndefined();
  });

  test('restore takes back the dismissal of this suggestion', async () => {
    const requests: unknown[] = [];
    const client = {
      scheduledAction: {
        restoreSuggestion: async (request: unknown) => {
          requests.push(request);
          return { data: undefined };
        },
      },
    } as unknown as MacroClient;

    await Suggestion.from(client, REPLY_SUGGESTION).restore();

    expect(requests).toEqual([{ path: { id: 'suggestion' } }]);
  });
});
