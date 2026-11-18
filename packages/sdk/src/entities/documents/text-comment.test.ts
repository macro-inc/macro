import { describe, expect, test } from 'bun:test';
import type { CommentOnDocumentTextData } from '../../../generated/storage/types.gen';
import { MacroApiError } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from './document';
import { CommentQuoteNotPlacedError } from './text-comment';

const MESSAGE = {
  id: 'comment',
  parent: { type: 'document', id: 'doc' },
  thread_id: null,
  sender_id: 'macro|commenter@example.com',
  mentions: [],
  content: 'Is this date still right?',
  created_at: '2026-11-05T09:00:00Z',
  updated_at: '2026-11-05T09:00:00Z',
  attachments: [],
  reactions: [],
};

type CommentRequest = Pick<CommentOnDocumentTextData, 'path' | 'body'>;

function clientAnswering(
  answer: (body: CommentOnDocumentTextData['body']) => unknown,
): { client: MacroClient; requests: CommentRequest[] } {
  const requests: CommentRequest[] = [];
  const client = {
    storage: {
      commentOnDocumentText: async (request: CommentRequest) => {
        requests.push(request);
        return answer(request.body);
      },
    },
  } as unknown as MacroClient;
  return { client, requests };
}

describe('document.commentOnText', () => {
  test('anchors the comment to the quote and returns it with the marked text', async () => {
    const { client, requests } = clientAnswering(() => ({
      data: { comment: MESSAGE, markedText: 'ships on Friday' },
      response: { status: 200 },
    }));

    const { comment, markedText } = await Document.byId(
      client,
      'doc',
    ).commentOnText('Is this date still right?', {
      quote: 'ships on Friday',
      occurrence: 2,
    });

    expect(requests).toEqual([
      {
        path: { document_id: 'doc' },
        body: {
          content: 'Is this date still right?',
          mentions: [],
          quote: 'ships on Friday',
          occurrence: 2,
        },
      },
    ]);
    expect(comment.id).toBe('comment');
    expect(comment.documentId).toBe('doc');
    expect(markedText).toBe('ships on Friday');
  });

  test('an ambiguous quote throws with the reason listing each appearance', async () => {
    const reason =
      'The text appears 2 times: pass occurrence 1 or 2 to choose one.';
    const { client } = clientAnswering(() => ({
      error: { error: 'quote_not_placed', reason },
      response: { status: 422 },
    }));

    const thrown = await Document.byId(client, 'doc')
      .commentOnText('Is this date still right?', { quote: 'Friday' })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(CommentQuoteNotPlacedError);
    expect((thrown as CommentQuoteNotPlacedError).reason).toBe(reason);
    expect((thrown as CommentQuoteNotPlacedError).message).toBe(reason);
  });

  test('a document that is not markdown or Word fails with the server message', async () => {
    const { client } = clientAnswering(() => ({
      error: {
        message:
          'inline comments anchor to text in Macro markdown and Word documents only',
      },
      response: { status: 400 },
    }));

    const thrown = await Document.byId(client, 'doc')
      .commentOnText('Is this right?', { quote: 'total' })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(MacroApiError);
    expect(thrown).not.toBeInstanceOf(CommentQuoteNotPlacedError);
    expect((thrown as MacroApiError).status).toBe(400);
  });
});
