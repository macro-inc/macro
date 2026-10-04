import type {
  CollabState,
  DeltaOp,
  EditOp,
  EditResult,
  RemoteChange,
} from '@core/docx-engine/types';
import { LoroDoc, LoroText } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { applyToText } from './delta';
import { DocxCollab, type DocxEngine } from './docx-collab';
import {
  DOCX_LORO_CONTAINERS,
  readBlock,
  readCollabState,
  writeCollabState,
} from './docx-loro';

const deltaText = (delta: DeltaOp[] = []) =>
  delta.map((op) => ('insert' in op ? op.insert : '')).join('');

const RESULT_BASE: Omit<EditResult, 'changes' | 'changed'> = {
  selection: {
    anchor: { block: '', offset: 0 },
    focus: { block: '', offset: 0 },
  },
  range: {
    from: { block: '', offset: 0 },
    to: { block: '', offset: 0 },
  },
  caret: null,
  rects: [],
  format: {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    superscript: false,
    subscript: false,
    font: null,
    size: null,
    color: null,
    style: null,
    styleName: null,
    align: null,
    list: false,
    canUndo: false,
    canRedo: false,
  },
};

/**
 * A stand-in for the engine: paragraphs as plain text, typing at a
 * selected position, and a gate that holds an edit in flight.
 */
class FakeEngine implements DocxEngine {
  texts = new Map<string, string>();
  private caret = { block: '', offset: 0 };
  gate: Promise<void> | null = null;

  constructor(state: CollabState) {
    for (const b of state.blocks)
      if (b.k === 'p') this.texts.set(b.id, deltaText(b.t));
  }

  async apply(ops: EditOp[]): Promise<EditResult | null> {
    if (this.gate) await this.gate;
    const changes: EditResult['changes'] = [];
    for (const op of ops) {
      if (op.op === 'select') this.caret = { ...op.focus };
      if (op.op === 'insertText') {
        const { block, offset } = this.caret;
        const text = this.texts.get(block) ?? '';
        this.texts.set(
          block,
          text.slice(0, offset) + op.text + text.slice(offset)
        );
        const delta: DeltaOp[] = offset
          ? [{ retain: offset }, { insert: op.text }]
          : [{ insert: op.text }];
        changes.push({ t: 'text', id: block, delta });
        this.caret = { block, offset: offset + op.text.length };
      }
    }
    return { ...RESULT_BASE, changed: changes.length > 0, changes };
  }

  async applyRemote(changes: RemoteChange[]): Promise<EditResult | null> {
    for (const c of changes) {
      if (c.t === 'block' && c.block.k === 'p')
        this.texts.set(c.block.id, deltaText(c.block.t));
      if (c.t === 'remove') this.texts.delete(c.id);
    }
    return { ...RESULT_BASE, changed: false, changes: [] };
  }
}

const STATE: CollabState = {
  parts: { '/word/document.xml': '<w:document/>' },
  types: {},
  rels: {},
  blocks: [
    {
      id: 'p1',
      k: 'p',
      p: '',
      o: 'a0',
      a: '',
      x: '',
      t: [{ insert: 'Hello world' }],
    },
  ],
};

function connect(a: LoroDoc, b: LoroDoc) {
  // Deliver each side's commits to the other, as the sync service would.
  a.subscribeLocalUpdates((update) => b.import(update));
  b.subscribeLocalUpdates((update) => a.import(update));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function paragraph(doc: LoroDoc, id: string): string {
  const map = doc.getMap(DOCX_LORO_CONTAINERS.blocks).get(id);
  return deltaText(readBlock(doc, id)?.t) + (map ? '' : '<missing>');
}

describe('DocxCollab', () => {
  it('seeds and reads back the shared state', () => {
    const doc = new LoroDoc();
    writeCollabState(doc, STATE);
    expect(readCollabState(doc)).toEqual(STATE);
    const text = doc
      .getMap(DOCX_LORO_CONTAINERS.blocks)
      .get('p1') as unknown as { get: (k: string) => unknown };
    expect(text.get('t')).toBeInstanceOf(LoroText);
  });

  it('publishes local edits and applies remote ones', async () => {
    const a = new LoroDoc();
    writeCollabState(a, STATE);
    const b = new LoroDoc();
    b.import(a.export({ mode: 'snapshot' }));
    connect(a, b);
    const ea = new FakeEngine(readCollabState(a));
    const eb = new FakeEngine(readCollabState(b));
    const ca = new DocxCollab(a, ea);
    const cb = new DocxCollab(b, eb);
    await ca.apply([
      {
        op: 'select',
        anchor: { block: 'p1', offset: 5 },
        focus: { block: 'p1', offset: 5 },
      },
      { op: 'insertText', text: ',' },
    ]);
    await settle();
    await cb.idle();
    expect(paragraph(b, 'p1')).toBe('Hello, world');
    expect(eb.texts.get('p1')).toBe('Hello, world');
    ca.dispose();
    cb.dispose();
  });

  it('converges when both peers type in one paragraph at once', async () => {
    const a = new LoroDoc();
    writeCollabState(a, STATE);
    const b = new LoroDoc();
    b.import(a.export({ mode: 'snapshot' }));
    connect(a, b);
    const ea = new FakeEngine(readCollabState(a));
    const eb = new FakeEngine(readCollabState(b));
    const ca = new DocxCollab(a, ea);
    const cb = new DocxCollab(b, eb);
    // A's edit is held in flight while B's lands in both documents.
    let release!: () => void;
    ea.gate = new Promise((resolve) => {
      release = resolve;
    });
    const pendingA = ca.apply([
      {
        op: 'select',
        anchor: { block: 'p1', offset: 11 },
        focus: { block: 'p1', offset: 11 },
      },
      { op: 'insertText', text: '!' },
    ]);
    await cb.apply([
      {
        op: 'select',
        anchor: { block: 'p1', offset: 0 },
        focus: { block: 'p1', offset: 0 },
      },
      { op: 'insertText', text: '>> ' },
    ]);
    await settle();
    release();
    ea.gate = null;
    await pendingA;
    await settle();
    await ca.idle();
    await cb.idle();
    expect(paragraph(a, 'p1')).toBe('>> Hello world!');
    expect(paragraph(b, 'p1')).toBe('>> Hello world!');
    // Both engines end up with what the shared document holds.
    expect(ea.texts.get('p1')).toBe('>> Hello world!');
    expect(eb.texts.get('p1')).toBe('>> Hello world!');
    ca.dispose();
    cb.dispose();
  });

  it('undo reverts this peer’s step and tells the engine', async () => {
    const doc = new LoroDoc();
    writeCollabState(doc, STATE);
    const engine = new FakeEngine(readCollabState(doc));
    const collab = new DocxCollab(doc, engine);
    await collab.apply([
      {
        op: 'select',
        anchor: { block: 'p1', offset: 0 },
        focus: { block: 'p1', offset: 0 },
      },
      { op: 'insertText', text: 'Well, ' },
    ]);
    expect(collab.canUndo()).toBe(true);
    expect(collab.undo()).toBe(true);
    await settle();
    await collab.idle();
    expect(paragraph(doc, 'p1')).toBe('Hello world');
    expect(engine.texts.get('p1')).toBe('Hello world');
    expect(applyToText('Hello world', [{ retain: 5 }, { delete: 6 }])).toBe(
      'Hello'
    );
    collab.dispose();
  });
});
