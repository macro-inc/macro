import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  type CommentMark,
  deleteCommentMark,
  MAX_MARK_TEXT,
  readCommentMarks,
  resolveMark,
  writeCommentMark,
} from './comment-marks';

const mark: CommentMark = { block: 'b', start: 4, length: 5, text: 'brown' };

describe('resolveMark', () => {
  it('keeps a mark whose text is still in place', () => {
    expect(
      resolveMark(mark, [
        { id: 'a', text: 'intro' },
        { id: 'b', text: 'The brown fox' },
      ])
    ).toEqual({ ...mark, relocated: false });
  });

  it('follows its text when the paragraph is edited', () => {
    expect(
      resolveMark(mark, [{ id: 'b', text: 'Then the quick brown fox' }])
    ).toMatchObject({ block: 'b', start: 15, relocated: true });
  });

  it('prefers the occurrence nearest the old position', () => {
    expect(
      resolveMark({ ...mark, start: 20 }, [
        { id: 'b', text: 'brown and then more brown' },
      ])
    ).toMatchObject({ start: 20 });
  });

  it('moves to the closest paragraph when a split carries the text away', () => {
    expect(
      resolveMark(mark, [
        { id: 'z', text: 'far brown' },
        { id: 'x', text: 'gap' },
        { id: 'b', text: 'The ' },
        { id: 'c', text: 'brown fox' },
      ])
    ).toMatchObject({ block: 'c', start: 0, relocated: true });
  });

  it('reports a mark whose text was deleted', () => {
    expect(resolveMark(mark, [{ id: 'b', text: 'The fox' }])).toBeNull();
  });
});

describe('comment mark storage', () => {
  it('round-trips marks through the collaborative document', () => {
    const doc = new LoroDoc();
    writeCommentMark(doc, 'm1', mark);
    const other = new LoroDoc();
    other.import(doc.export({ mode: 'snapshot' }));
    expect(readCommentMarks(other).get('m1')).toEqual(mark);
    deleteCommentMark(doc, 'm1');
    expect(readCommentMarks(doc).size).toBe(0);
  });

  it('stores long selections so they resolve in place, not as a move', () => {
    const doc = new LoroDoc();
    const text = 'x'.repeat(MAX_MARK_TEXT + 200);
    writeCommentMark(doc, 'm1', {
      block: 'b',
      start: 0,
      length: text.length,
      text,
    });
    const stored = readCommentMarks(doc).get('m1');
    expect(stored).toMatchObject({ length: MAX_MARK_TEXT });
    expect(resolveMark(stored!, [{ id: 'b', text }])).toMatchObject({
      relocated: false,
    });
  });

  it('ignores malformed marks', () => {
    const doc = new LoroDoc();
    doc.getMap('docxMarks').set('bad', '{"block":1}');
    doc.getMap('docxMarks').set('worse', 'not json');
    expect(readCommentMarks(doc).size).toBe(0);
  });
});
