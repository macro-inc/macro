import { describe, expect, test } from 'bun:test';
import type { Idea as IdeaRecord } from '../../../generated/scheduled-action/types.gen';
import type { MacroClient } from '../../utils/client';
import { EmailDraft } from '../email/draft';
import { EmailThread } from '../email/thread';
import { Idea } from './idea';

const REPLY_IDEA: IdeaRecord = {
  id: 'idea',
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

describe('Idea drafts', () => {
  test('attachDraft sends the draft handle as its id, with the reason', async () => {
    const requests: unknown[] = [];
    const client = {
      scheduledAction: {
        attachIdeaDraft: async (request: unknown) => {
          requests.push(request);
          return { data: { ok: true, problems: [], idea: REPLY_IDEA } };
        },
      },
    } as unknown as MacroClient;
    const idea = Idea.from(client, REPLY_IDEA);

    const outcome = await idea.attachDraft(
      EmailDraft.byId(client, 'draft'),
      'Drafted the headcount reply',
    );

    expect(requests).toEqual([
      {
        path: { id: 'idea' },
        body: { emailDraftId: 'draft', reason: 'Drafted the headcount reply' },
      },
    ]);
    expect(outcome.ok).toBe(true);
    expect(outcome.idea?.draft?.id).toBe('draft');
  });

  test('a reply idea names its draft as a handle; other ideas have none', () => {
    const client = {} as MacroClient;
    expect(Idea.from(client, REPLY_IDEA).draft).toBeInstanceOf(EmailDraft);
    expect(
      Idea.from(client, { ...REPLY_IDEA, draft: null }).draft,
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

describe('Idea accept', () => {
  test('accept sends the idea as it was read', async () => {
    const requests: unknown[] = [];
    const client = {
      scheduledAction: {
        acceptIdea: async (request: unknown) => {
          requests.push(request);
          return { data: undefined };
        },
      },
    } as unknown as MacroClient;

    await Idea.from(client, REPLY_IDEA).accept();

    expect(requests).toEqual([
      { path: { id: 'idea' }, body: { updatedAt: '2026-11-09T00:00:00Z' } },
    ]);
  });
});
