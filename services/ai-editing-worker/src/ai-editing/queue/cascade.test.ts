import { describe, expect, it } from 'vitest';
import { DocumentEditor } from '../editor/document-editor';
import { type OpResult, summarize } from './runner';

/**
 * A failed op leaves its ref dangling, so every dependent op fails too. Those
 * knock-on failures used to be reported as peers of the real one, producing a
 * wall of `No node with id "<nanoid>"` lines with nothing to indicate which
 * failure to act on. Unknown-id errors are the single largest remaining trigger
 * for a coder retry on the current corpus runs.
 */
const ok = (kind: string, node: string): OpResult =>
  ({ ok: true, op: { kind, node } }) as unknown as OpResult;
const bad = (kind: string, node: string, error: string): OpResult =>
  ({ ok: false, op: { kind, node }, error }) as unknown as OpResult;

describe('summarize', () => {
  it('reports ok when nothing failed', () => {
    expect(summarize([ok('setText', 'a')])).toBe('ok');
  });

  it('reports a single independent failure verbatim', () => {
    const out = summarize([bad('setText', 'a', 'No node with id "a"')]);
    expect(out).toBe('error: setText: No node with id "a"');
    expect(out).not.toMatch(/consequence/);
  });

  it('reports independent failures as peers', () => {
    const out = summarize([
      bad('setText', 'a', 'boom'),
      bad('setText', 'b', 'bang'),
    ]);
    expect(out).toContain('error: setText: boom');
    expect(out).toContain('error: setText: bang');
    expect(out).not.toMatch(/consequence/);
  });

  it('collapses failures that depend on an already-failed op', () => {
    const out = summarize([
      bad('insertParagraphAfter', 'ref-1', 'target missing'),
      bad('setText', 'ref-1', 'No node with id "ref-1"'),
      bad('bold', 'ref-1', 'No node with id "ref-1"'),
    ]);
    // The root cause is stated once...
    expect(out).toContain('error: insertParagraphAfter: target missing');
    // ...and the knock-on failures are summarised, not repeated.
    expect(out).not.toContain('No node with id "ref-1"');
    expect(out).toMatch(/2 later ops referenced a node/);
    expect(out).toMatch(/Fix the first error/);
  });

  it('uses singular wording for one consequence', () => {
    const out = summarize([
      bad('insertParagraphAfter', 'ref-1', 'target missing'),
      bad('setText', 'ref-1', 'gone'),
    ]);
    expect(out).toMatch(/1 later op referenced/);
  });

  it('keeps a genuinely unrelated failure visible alongside a cascade', () => {
    const out = summarize([
      bad('insertParagraphAfter', 'ref-1', 'target missing'),
      bad('setText', 'ref-1', 'gone'),
      bad('setCell', 'table-9', 'not a table'),
    ]);
    expect(out).toContain('error: setCell: not a table');
    expect(out).toMatch(/later op referenced/);
  });
});

describe('id argument validation', () => {
  const editor = () =>
    new DocumentEditor({ validIds: new Set(['real']), refs: ['ref-1'] });

  it('accepts a known id', () => {
    expect(() => editor().setText('real', 'x')).not.toThrow();
  });

  it('names the type when handed an object instead of an id', () => {
    // `unknown id "[object Object]"` told the writer nothing about what it passed.
    expect(() =>
      editor().setText({ id: 'real' } as unknown as string, 'x')
    ).toThrow(/expected a node id string but got an object with keys \[id\]/);
  });

  it('names the type when handed an array', () => {
    expect(() =>
      editor().setText(['real'] as unknown as string, 'x')
    ).toThrow(/an array of 1/);
  });

  it('rejects undefined with a readable message', () => {
    expect(() => editor().setText(undefined as unknown as string, 'x')).toThrow(
      /expected a node id string but got undefined/
    );
  });

  it('rejects an empty id', () => {
    expect(() => editor().setText('', 'x')).toThrow(/empty string/);
  });

  it('still reports a plain unknown id plainly', () => {
    expect(() => editor().setText('nope', 'x')).toThrow(/unknown id "nope"/);
  });
});
