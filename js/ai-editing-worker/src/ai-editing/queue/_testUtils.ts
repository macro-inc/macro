import type { DocWriter } from '../doc/interfaces';
import type { DocumentOp } from '../editor/ops';
import type { Awareness } from './types';

/** Records every DocWriter apply call; can be told to throw on a given kind (or several). */
export function recordingWriter(
  throwOn?:
    | { kind: string; error: string }
    | Array<{ kind: string; error: string }>
) {
  const throwers = throwOn
    ? Array.isArray(throwOn)
      ? throwOn
      : [throwOn]
    : [];
  const edits: DocumentOp[] = [];
  const w: DocWriter = {
    apply(op: DocumentOp) {
      const t = throwers.find((x) => x.kind === op.kind);
      if (t) throw new Error(t.error);
      edits.push(op);
    },
  };
  return { w, edits };
}

export function recordingAwareness() {
  const seen: Awareness[] = [];
  return { source: { apply: (x: Awareness) => void seen.push(x) }, seen };
}
