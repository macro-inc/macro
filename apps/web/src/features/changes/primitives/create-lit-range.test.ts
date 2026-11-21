import type { LineRange } from '@app/components/diff-view/model/lines';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createLitRange } from './create-lit-range';

const inA: LineRange = {
  path: 'a.ts',
  side: 'additions',
  lineNumber: 3,
  endLineNumber: 4,
};
const inB: LineRange = {
  path: 'b.ts',
  side: 'additions',
  lineNumber: 12,
  endLineNumber: 12,
};

function setup() {
  const [note, setNote] = createSignal<LineRange>();
  const [pointed, setPointed] = createSignal<LineRange>();
  const lit = createLitRange(note, pointed);
  return { lit, setNote, setPointed };
}

describe('createLitRange', () => {
  it('lights a note started after a code link into another file', () => {
    createRoot((dispose) => {
      const { lit, setNote, setPointed } = setup();
      setPointed(inB);
      expect(lit()).toEqual(inB);
      setNote(inA);
      expect(lit()).toEqual(inA);
      dispose();
    });
  });

  it('lights a code link followed after a note in another file', () => {
    createRoot((dispose) => {
      const { lit, setNote, setPointed } = setup();
      setNote(inA);
      setPointed(inB);
      expect(lit()).toEqual(inB);
      // Closing the note leaves the link's lines lit.
      setNote(undefined);
      expect(lit()).toEqual(inB);
      dispose();
    });
  });
});
