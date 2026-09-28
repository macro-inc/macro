import '../polyfills/prism';
import { describe, expect, it } from 'bun:test';
import { toCommentMarkContext } from './convsersions';

const text = (value: string) => ({
  type: 'text',
  version: 1,
  text: value,
  format: 0,
  detail: 0,
  mode: 'normal',
  style: '',
});

const document = {
  root: {
    type: 'root',
    version: 1,
    format: '',
    indent: 0,
    direction: null,
    children: [
      {
        type: 'paragraph',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        textFormat: 0,
        textStyle: '',
        children: [
          text('The second stage '),
          {
            type: 'comment-mark',
            version: 1,
            format: '',
            indent: 0,
            direction: null,
            ids: ['mark-1'],
            threadId: undefined,
            isDraft: false,
            children: [text('backfills the ledger')],
          },
          text(' from the archive.'),
        ],
      },
    ],
  },
};

describe('toCommentMarkContext', () => {
  it('resolves a mark in a stored document to its text and block', () => {
    expect(toCommentMarkContext(document as never, 'mark-1')).toEqual({
      markedText: 'backfills the ledger',
      surroundingText:
        'The second stage backfills the ledger from the archive.',
    });
  });

  it('is null for a mark the document no longer carries', () => {
    expect(toCommentMarkContext(document as never, 'gone')).toBeNull();
  });
});
