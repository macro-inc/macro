import type { DocWriter } from '../doc/interfaces';
import type { Edit } from '../editor/ops';
import type { Awareness } from './types';

/** Records every DocWriter apply call; can be told to throw on a given fn (or several). */
export function recordingWriter(
  throwOn?: { fn: string; error: string } | Array<{ fn: string; error: string }>
) {
  const throwers = throwOn
    ? Array.isArray(throwOn)
      ? throwOn
      : [throwOn]
    : [];
  const edits: Edit[] = [];
  const w: DocWriter = {
    apply(edit: Edit) {
      const t = throwers.find((x) => x.fn === edit.fn);
      if (t) throw new Error(t.error);
      edits.push(edit);
    },
  };
  return { w, edits };
}

export function recordingAwareness() {
  const seen: Awareness[] = [];
  return { source: { apply: (x: Awareness) => void seen.push(x) }, seen };
}
