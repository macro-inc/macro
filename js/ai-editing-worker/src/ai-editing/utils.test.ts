/**
 * Tests for serializeWithIds — every BLOCK-LEVEL node (headings, paragraphs,
 * quotes, list items incl. nested) carries its durable id; inline spans do NOT
 * surface an id; and every emitted id resolves to a real node in the session.
 *
 * NOTE: import id helpers from the SAME specifier the implementation uses
 * (`../plugins/nodeIdPlugin`) — a different path re-registers the idState
 * StateConfig and throws a "State key collision".
 */

import { $getRoot } from 'lexical';
import { $dfsIterator } from '@lexical/utils';
import { describe, expect, it } from 'vitest';
import { createEditingSession, loadMarkdown } from './ai-toolkit';
import { findInDocument, serializeHeadings, serializeWithIds } from './utils';

const ID = /\{([A-Za-z0-9_-]+)\|[a-z]+\}/g;

function idsIn(md: string): string[] {
  return [...md.matchAll(ID)].map((m) => m[1]);
}

describe('serializeWithIds — block-level ids', () => {
  it('tags headings and paragraphs with exactly one id each (no inline ids)', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# Title\n\nhello world');
    const out = serializeWithIds(s);

    const lines = out
      .split('\n')
      .filter((l) => l.replace(/^\d+ \| /, '').trim());
    expect(lines[0]).toMatch(/# Title \{[A-Za-z0-9_-]+\|heading\}$/);
    expect(lines[1]).toMatch(/hello world \{[A-Za-z0-9_-]+\|paragraph\}$/);
  });

  it('does NOT surface inline-span ids', () => {
    const s = createEditingSession();
    loadMarkdown(s, 'the **bold** word');
    const out = serializeWithIds(s);

    expect(out).toContain('**bold**');
    // a single paragraph with formatted text => exactly one id (the block)
    expect(idsIn(out)).toHaveLength(1);
  });

  it('tags every nested list item with its own id', () => {
    const s = createEditingSession();
    loadMarkdown(s, '- a\n- b\n  - b1\n- c');
    const out = serializeWithIds(s);

    for (const line of out.split('\n').filter((l) => l.trim())) {
      expect(line).toMatch(/\{[A-Za-z0-9_-]+\|[a-z]+\}\s*$/); // every item line ends with an id
    }
    // The real markdown exporter flattens nesting once markers are injected, so
    // b1 renders as a sibling line — still tagged with its own listitem id.
    expect(out).toMatch(/- b1 \{[A-Za-z0-9_-]+\|listitem\}/);
  });

  it('every emitted id resolves to a real node in the document', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# Plan\n\nintro\n\n- one\n- two\n  - two-a\n\n> a quote');
    const emitted = new Set(idsIn(serializeWithIds(s)));
    expect(emitted.size).toBeGreaterThan(0);

    const present = new Set<string>();
    s.editor.getEditorState().read(() => {
      for (const { node } of $dfsIterator($getRoot())) {
        const key = s.ids.nodeKeyToIdMap.get(node.getKey());
        if (key) present.add(key);
      }
    });

    for (const id of emitted) expect(present.has(id)).toBe(true);
  });

  it('emits an id for every block-level node (not the root or list containers)', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# H\n\npara\n\n- x\n- y');
    const emitted = new Set(idsIn(serializeWithIds(s)));

    let blocks = 0;
    s.editor.getEditorState().read(() => {
      for (const { node } of $dfsIterator($getRoot())) {
        if (node === $getRoot()) continue;
        if (node.getType() === 'list') continue; // container, no own line
        // count only block-level (non-inline) elements
        if (typeof node.isInline === 'function' && !node.isInline()) blocks++;
      }
    });

    expect(emitted.size).toBe(blocks);
  });

  it('ids are unique', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# A\n\n- one\n- two\n\nthree');
    const all = idsIn(serializeWithIds(s));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('serializeHeadings', () => {
  it('returns only heading lines', () => {
    const s = createEditingSession();
    loadMarkdown(
      s,
      '# Title\n\nsome paragraph\n\n## Section\n\n- list item\n\n### Sub'
    );
    const out = serializeHeadings(s);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/# Title/);
    expect(lines[1]).toMatch(/## Section/);
    expect(lines[2]).toMatch(/### Sub/);
  });

  it('excludes paragraphs, list items, and blank lines', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# H\n\nparagraph\n\n- item');
    const out = serializeHeadings(s);
    expect(out).not.toContain('paragraph');
    expect(out).not.toContain('item');
  });

  it('preserves block ids on heading lines', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# Hello');
    const out = serializeHeadings(s);
    expect(out).toMatch(/\{[A-Za-z0-9_-]+\|heading\}/);
  });

  it('returns empty string for a document with no headings', () => {
    const s = createEditingSession();
    loadMarkdown(s, 'just a paragraph');
    expect(serializeHeadings(s)).toBe('');
  });
});

describe('findInDocument', () => {
  it('finds an exact match', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# Title\n\nThe quick brown fox\n\n## Another');
    const out = findInDocument(s, 'quick brown fox');
    expect(out).toContain('quick brown fox');
  });

  it('returns (no matches) when needle is absent', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# Title\n\nhello world');
    expect(findInDocument(s, 'xyzzy not here')).toBe('(no matches)');
  });

  it('includes surrounding context lines', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# Title\n\nbefore\n\ntarget line\n\nafter\n\n## End');
    const out = findInDocument(s, 'target line', 2);
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('is case-insensitive', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# Title\n\nHello World');
    expect(findInDocument(s, 'hello world')).toContain('Hello World');
  });

  it('matches through markdown formatting markers', () => {
    const s = createEditingSession();
    loadMarkdown(s, '# Title\n\nsome **bold** text here');
    const out = findInDocument(s, 'bold text');
    expect(out).toContain('bold');
  });

  it('returns at most 3 matches separated by ---', () => {
    const s = createEditingSession();
    loadMarkdown(s, 'foo\n\nfoo\n\nfoo\n\nfoo');
    const out = findInDocument(s, 'foo');
    expect(out.split('\n---\n').length).toBeLessThanOrEqual(3);
  });
});
