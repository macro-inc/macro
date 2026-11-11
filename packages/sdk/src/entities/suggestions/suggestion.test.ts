import { describe, expect, test } from 'bun:test';
import type { Suggestion as SuggestionRecord } from '../../../generated/scheduled-action/types.gen';
import type { MacroClient } from '../../utils/client';
import { EmailDraft } from '../email/draft';
import { EmailThread } from '../email/thread';
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
          return { data: { ok: true, problems: [], suggestion: REPLY_SUGGESTION } };
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
    expect(Suggestion.from(client, REPLY_SUGGESTION).draft).toBeInstanceOf(EmailDraft);
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
      { path: { id: 'suggestion' }, body: { updatedAt: '2026-11-09T00:00:00Z' } },
    ]);
  });
});
