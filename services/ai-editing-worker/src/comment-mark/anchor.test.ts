import { $convertToMarkdownString } from '@lexical/markdown';
import { $dfs } from '@lexical/utils';
import {
  $getCommentMarkText,
  $isCommentNode,
  type CommentNode,
} from '@macro-inc/lexical-core';
import { INTERNAL_TRANSFORMERS } from '@macro-inc/lexical-core/transformers';
import { $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';
import { edit, read, setup } from '../ai-editing/ai-toolkit/_test-helpers';
import type { LexicalSession } from '../ai-editing/ai-toolkit/session';
import { $addCommentMark, $removeCommentMark } from './anchor';

const MARK = '0199a1b2-0000-7000-8000-000000000001';
const OTHER = '0199a1b2-0000-7000-8000-000000000002';

function marks(session: LexicalSession): CommentNode[] {
  return read(session, () =>
    $dfs($getRoot())
      .map(({ node }) => node)
      .filter($isCommentNode)
  );
}

function markedText(session: LexicalSession, id = MARK): string {
  return read(session, () => $getCommentMarkText(id));
}

function text(session: LexicalSession): string {
  return read(session, () => $getRoot().getTextContent());
}

function markdown(session: LexicalSession): string {
  return read(session, () => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
}

describe('$addCommentMark', () => {
  it('wraps the quoted text in a committed comment mark', () => {
    const { session } = setup('The quick brown fox jumps.');
    const result = edit(session, () => $addCommentMark(MARK, 'brown fox'));

    expect(result).toEqual({
      ok: true,
      markedText: 'brown fox',
      surroundingText: 'The quick brown fox jumps.',
    });
    const [mark] = marks(session);
    read(session, () => {
      expect(mark.getIDs()).toEqual([MARK]);
      expect(mark.getIsDraft()).toBe(false);
      expect(mark.getThreadId()).toBeUndefined();
    });
    expect(text(session)).toBe('The quick brown fox jumps.');
  });

  it('crosses formatting and link boundaries within a block', () => {
    const { session } = setup(
      'Ship **the new** [pricing page](https://example.com) today.'
    );
    const result = edit(session, () =>
      $addCommentMark(MARK, 'new pricing page today')
    );

    expect(result.ok).toBe(true);
    expect(markedText(session)).toBe('new pricing page today');
    expect(text(session)).toBe('Ship the new pricing page today.');
    expect(markdown(session)).toContain('"url":"https://example.com"');
  });

  it('trims the quote before matching', () => {
    const { session } = setup('Alpha beta gamma.');
    edit(session, () => $addCommentMark(MARK, '  beta  '));
    expect(markedText(session)).toBe('beta');
  });

  it('refuses text that is not in the document', () => {
    const { session } = setup('Alpha beta gamma.');
    const result = edit(session, () => $addCommentMark(MARK, 'delta'));
    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
    expect(marks(session)).toHaveLength(0);
  });

  it('refuses markdown syntax the reader does not see', () => {
    const { session } = setup('Alpha **beta** gamma.');
    const result = edit(session, () => $addCommentMark(MARK, '**beta**'));
    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('refuses text crossing from one block into the next', () => {
    const { session } = setup('First paragraph ends.\n\nSecond starts here.');
    const result = edit(session, () =>
      $addCommentMark(MARK, 'ends. Second starts')
    );
    expect(result).toMatchObject({ ok: false, reason: 'spans_blocks' });
    expect(marks(session)).toHaveLength(0);
  });

  it('spots a cross-block quote when a block ends in a space', () => {
    const { session } = setup('First paragraph ends. \n\nSecond starts here.');
    const result = edit(session, () =>
      $addCommentMark(MARK, 'ends. Second starts')
    );
    expect(result).toMatchObject({ ok: false, reason: 'spans_blocks' });
  });

  it('does not call a spacing slip inside one block a cross-block quote', () => {
    const { session } = setup('Alpha beta gamma.');
    const result = edit(session, () => $addCommentMark(MARK, 'beta  gamma'));
    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('refuses repeated text with no occurrence and lists each one', () => {
    const { session } = setup('Owner: TBD.\n\nDeadline: TBD.');
    const result = edit(session, () => $addCommentMark(MARK, 'TBD'));
    expect(result.ok).toBe(false);
    if (!('reason' in result)) return;
    expect(result.reason).toBe('ambiguous');
    expect(result.message).toContain('appears 2 times');
    expect(result.message).toContain('1: "Owner: TBD."');
    expect(result.message).toContain('2: "Deadline: TBD."');
    expect(marks(session)).toHaveLength(0);
  });

  it('marks the chosen occurrence in document order', () => {
    const { session } = setup('Owner: TBD.\n\nDeadline: TBD.');
    const result = edit(session, () => $addCommentMark(MARK, 'TBD', 2));
    expect(result).toMatchObject({
      ok: true,
      markedText: 'TBD',
      surroundingText: 'Deadline: TBD.',
    });
  });

  it('refuses an occurrence past the last one', () => {
    const { session } = setup('Owner: TBD.');
    const result = edit(session, () => $addCommentMark(MARK, 'TBD', 2));
    expect(result).toMatchObject({
      ok: false,
      reason: 'occurrence_out_of_range',
    });
  });

  it('finds text in list items and headings', () => {
    const { session } = setup('# Launch plan\n\n- ship the beta\n- tell sales');
    edit(session, () => $addCommentMark(MARK, 'the beta'));
    edit(session, () => $addCommentMark(OTHER, 'Launch'));
    expect(markedText(session)).toBe('the beta');
    expect(markedText(session, OTHER)).toBe('Launch');
  });

  it('does not mark inside code blocks', () => {
    const { session } = setup('```\nconst secret = 1;\n```');
    const result = edit(session, () => $addCommentMark(MARK, 'secret'));
    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('leaves a mark it already placed alone when asked again', () => {
    const { session } = setup('Alpha beta gamma.');
    edit(session, () => $addCommentMark(MARK, 'beta'));
    const again = edit(session, () => $addCommentMark(MARK, 'beta'));
    expect(again).toMatchObject({ ok: true, markedText: 'beta' });
    expect(marks(session)).toHaveLength(1);
  });

  it('overlaps an existing comment mark without disturbing it', () => {
    const { session } = setup('Alpha beta gamma delta.');
    edit(session, () => $addCommentMark(OTHER, 'beta gamma'));
    edit(session, () => $addCommentMark(MARK, 'gamma delta'));
    expect(markedText(session, OTHER)).toBe('beta gamma');
    expect(markedText(session)).toBe('gamma delta');
  });
});

describe('$removeCommentMark', () => {
  it('unwraps the mark and keeps its text', () => {
    const { session } = setup('Alpha **beta** gamma.');
    edit(session, () => $addCommentMark(MARK, 'beta gamma'));
    expect(edit(session, () => $removeCommentMark(MARK))).toBe(true);
    expect(marks(session)).toHaveLength(0);
    expect(markdown(session)).toBe('Alpha **beta** gamma.');
  });

  it('leaves another comment sharing the text in place', () => {
    const { session } = setup('Alpha beta gamma.');
    edit(session, () => $addCommentMark(OTHER, 'beta'));
    edit(session, () => $addCommentMark(MARK, 'beta'));
    edit(session, () => $removeCommentMark(MARK));
    expect(markedText(session)).toBe('');
    expect(markedText(session, OTHER)).toBe('beta');
  });

  it('reports a mark the document does not carry', () => {
    const { session } = setup('Alpha.');
    expect(edit(session, () => $removeCommentMark(MARK))).toBe(false);
  });
});
