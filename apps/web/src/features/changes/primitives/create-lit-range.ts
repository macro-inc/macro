import type { LineRange } from '@app/components/diff-view/model/lines';
import { type Accessor, createComputed, createSignal, on } from 'solid-js';

/**
 * The one range the diff lights: a note's (a draft or a focused note) or a
 * code link's lines, whichever was set last. A note started after a link
 * lights at once, and a link followed after a note lights its own lines.
 */
export function createLitRange(
  note: Accessor<LineRange | undefined>,
  pointed: Accessor<LineRange | undefined>
): Accessor<LineRange | undefined> {
  const [latest, setLatest] = createSignal<'note' | 'pointed'>('note');
  createComputed(
    on(note, (range) => {
      if (range) setLatest('note');
    })
  );
  createComputed(
    on(pointed, (range) => {
      if (range) setLatest('pointed');
    })
  );
  return () => {
    const noteRange = note();
    const pointedRange = pointed();
    if (!noteRange) return pointedRange;
    if (!pointedRange) return noteRange;
    return latest() === 'pointed' ? pointedRange : noteRange;
  };
}
