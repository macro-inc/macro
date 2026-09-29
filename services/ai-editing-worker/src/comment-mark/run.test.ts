import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import {
  LoroDoc,
  type LoroMap,
  type LoroMovableList,
  type LoroText,
} from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { applyCommentMarkChange } from './run';

const DOC = 'doc-1';
const MARK = '0199a1b2-0000-7000-8000-000000000001';

type Node = {
  type?: string;
  ids?: string[];
  text?: string;
  children?: Node[];
};

async function worker(snapshot: Uint8Array) {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId: DOC });
  (await manager.initializeFromSnapshot(snapshot))._unsafeUnwrap();
  return manager;
}

function human(snapshot: Uint8Array): LoroDoc {
  const doc = new LoroDoc();
  doc.import(snapshot);
  return doc;
}

/** The LoroText of the first paragraph's first text node, as a typist edits it. */
function firstText(doc: LoroDoc): LoroText {
  const paragraph = (doc.getMap('root').get('children') as LoroMovableList).get(
    0
  ) as LoroMap;
  const text = (paragraph.get('children') as LoroMovableList).get(0) as LoroMap;
  return text.get('text') as LoroText;
}

function exchange(a: LoroDoc, b: LoroDoc) {
  const fromA = a.export({ mode: 'update', from: b.oplogVersion() });
  const fromB = b.export({ mode: 'update', from: a.oplogVersion() });
  a.import(fromB);
  b.import(fromA);
}

function walk(node: Node, out: Node[] = []): Node[] {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}

function textOf(node: Node): string {
  return (node.text ?? '') + (node.children ?? []).map(textOf).join('');
}

function tree(doc: LoroDoc): Node {
  return (doc.toJSON() as { root: Node }).root;
}

describe('applyCommentMarkChange', () => {
  it('reaches other peers as a comment mark around the quoted text', async () => {
    const snapshot = (await markdownToLoroSnapshot('The quick brown fox.'))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);

    const result = await applyCommentMarkChange(
      manager,
      createNoopLiveSyncSource(DOC),
      { action: 'add', markId: MARK, text: 'brown fox' }
    );
    expect(result).toMatchObject({ ok: true, markedText: 'brown fox' });

    exchange(manager.doc, peer);
    const marks = walk(tree(peer)).filter((n) => n.type === 'comment-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].ids).toEqual([MARK]);
    expect(textOf(marks[0])).toBe('brown fox');
    expect(textOf(tree(peer))).toBe('The quick brown fox.');
    manager.dispose();
  });

  it('merges with typing that lands while the mark is placed', async () => {
    const snapshot = (await markdownToLoroSnapshot('The quick brown fox.'))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);

    // Typed before the worker's change reaches this peer, into the very text
    // run the mark splits. Loro keeps every keystroke and both peers converge
    // on one mark, though typing in a run the split removed can surface
    // elsewhere in the paragraph, as it does when a person places a comment.
    const typed = firstText(peer);
    typed.insert('The quick brown fox.'.length - 1, ' ran');
    typed.insert('The quick '.length, 'big ');
    peer.commit();

    await applyCommentMarkChange(manager, createNoopLiveSyncSource(DOC), {
      action: 'add',
      markId: MARK,
      text: 'quick brown',
    });
    exchange(manager.doc, peer);

    expect(manager.doc.toJSON()).toEqual(peer.toJSON());
    const text = textOf(tree(peer));
    expect(text).toContain('big ');
    expect(text).toContain(' ran');
    expect(text.replace('big ', '').replace(' ran', '')).toBe(
      'The quick brown fox.'
    );
    const marks = walk(tree(peer)).filter((n) => n.type === 'comment-mark');
    expect(marks).toHaveLength(1);
    expect(textOf(marks[0])).toBe('quick brown');
    manager.dispose();
  });

  it('pushes nothing when the text cannot be anchored', async () => {
    const snapshot = (await markdownToLoroSnapshot('The quick brown fox.'))!;
    const manager = await worker(snapshot);
    const before = manager.doc.oplogVersion();

    const result = await applyCommentMarkChange(
      manager,
      createNoopLiveSyncSource(DOC),
      { action: 'add', markId: MARK, text: 'lazy dog' }
    );
    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
    expect(manager.doc.oplogVersion().compare(before)).toBe(0);
    manager.dispose();
  });
});
