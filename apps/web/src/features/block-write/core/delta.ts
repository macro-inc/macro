import type { DeltaOp } from '@core/docx-engine/types';

/**
 * Rich-text deltas (Quill's format, as Loro and the DOCX engine exchange
 * them): operational transformation of one paragraph's concurrent edits.
 *
 * The engine computes each local edit against the text it last knew; when
 * another peer's change reached the shared document meanwhile, the local
 * delta is transformed past it before it is applied.
 */

type Attributes = Record<string, string | null>;

function length(op: DeltaOp): number {
  if ('delete' in op) return op.delete;
  if ('retain' in op) return op.retain;
  return op.insert.length;
}

/** Walks a delta op by op, splitting ops on demand. */
class Cursor {
  private index = 0;
  private offset = 0;

  constructor(private readonly ops: readonly DeltaOp[]) {}

  hasNext(): boolean {
    return this.index < this.ops.length;
  }

  peekType(): 'insert' | 'delete' | 'retain' {
    const op = this.ops[this.index];
    if (!op) return 'retain';
    if ('insert' in op) return 'insert';
    if ('delete' in op) return 'delete';
    return 'retain';
  }

  peekLength(): number {
    const op = this.ops[this.index];
    return op ? length(op) - this.offset : Number.POSITIVE_INFINITY;
  }

  /** The next op, or its first `max` units. Past the end: a plain retain. */
  next(max = Number.POSITIVE_INFINITY): DeltaOp {
    const op = this.ops[this.index];
    if (!op) return { retain: max };
    const rest = length(op) - this.offset;
    const take = Math.min(rest, max);
    const start = this.offset;
    if (take === rest) {
      this.index++;
      this.offset = 0;
    } else {
      this.offset += take;
    }
    if ('delete' in op) return { delete: take };
    if ('retain' in op)
      return op.attributes
        ? { retain: take, attributes: op.attributes }
        : { retain: take };
    const insert = op.insert.slice(start, start + take);
    return op.attributes ? { insert, attributes: op.attributes } : { insert };
  }
}

function sameAttributes(a?: Attributes, b?: Attributes): boolean {
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  if (ka.length !== kb.length) return false;
  return ka.every((k) => b?.[k] === a?.[k]);
}

/** Appends an op, merging it with the last one when they combine. */
function push(out: DeltaOp[], op: DeltaOp) {
  if (length(op) === 0) return;
  const last = out[out.length - 1];
  if (last) {
    if ('delete' in op && 'delete' in last) {
      last.delete += op.delete;
      return;
    }
    if (
      'retain' in op &&
      'retain' in last &&
      sameAttributes(op.attributes, last.attributes)
    ) {
      last.retain += op.retain;
      return;
    }
    if (
      'insert' in op &&
      'insert' in last &&
      sameAttributes(op.attributes, last.attributes)
    ) {
      last.insert += op.insert;
      return;
    }
  }
  out.push({ ...op } as DeltaOp);
}

/** Drops a trailing plain retain. */
function chop(ops: DeltaOp[]): DeltaOp[] {
  const last = ops[ops.length - 1];
  if (last && 'retain' in last && !last.attributes) ops.pop();
  return ops;
}

/**
 * `b` rewritten to apply after `a`, where both were made against the same
 * text and `a` is already applied. At the same position `a`'s insertion
 * comes first (`b`'s with `bFirst`); when both change the same attribute,
 * `b`'s value wins.
 */
export function transform(
  a: readonly DeltaOp[],
  b: readonly DeltaOp[],
  bFirst = false
): DeltaOp[] {
  const ai = new Cursor(a);
  const bi = new Cursor(b);
  const out: DeltaOp[] = [];
  while (ai.hasNext() || bi.hasNext()) {
    const bInserts = bi.peekType() === 'insert' && bi.hasNext();
    if (ai.peekType() === 'insert' && ai.hasNext() && !(bFirst && bInserts)) {
      // Text the other side inserted: step over it.
      push(out, { retain: length(ai.next()) });
      continue;
    }
    if (bi.peekType() === 'insert' && bi.hasNext()) {
      push(out, bi.next());
      continue;
    }
    if (!bi.hasNext()) break;
    const n = Math.min(ai.peekLength(), bi.peekLength());
    const aop = ai.next(n);
    const bop = bi.next(n);
    if ('delete' in aop) {
      // Already gone: whatever b did to it no longer applies.
      continue;
    }
    if ('delete' in bop) {
      push(out, bop);
      continue;
    }
    // Both kept the text: b's attribute changes still apply.
    const attributes = 'retain' in bop ? bop.attributes : undefined;
    push(out, attributes ? { retain: n, attributes } : { retain: n });
  }
  return chop(out);
}

/** Applies a delta to plain text (attributes ignored), for tests and checks. */
export function applyToText(text: string, delta: readonly DeltaOp[]): string {
  let out = '';
  let at = 0;
  for (const op of delta) {
    if ('insert' in op) out += op.insert;
    else if ('delete' in op) at += op.delete;
    else {
      out += text.slice(at, at + op.retain);
      at += op.retain;
    }
  }
  return out + text.slice(at);
}
