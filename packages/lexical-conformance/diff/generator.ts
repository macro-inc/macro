import fc from 'fast-check';
import type { Command, Position, Snapshot } from './commands';
export const alphabet = [
  'a',
  'Z',
  ' ',
  '\t',
  '\n',
  '😀',
  '𝔸',
  'e\u0301',
  '👩‍👩‍👧',
  'א',
  'ب',
  '\uFEFF',
  '\u00a0',
  '\u2028',
];
export const stepArbitrary = fc.record({
  op: fc.integer({ min: 0, max: 99 }),
  a: fc.nat(100000),
  b: fc.nat(100000),
  c: fc.nat(100000),
  text: fc
    .array(fc.constantFrom(...alphabet), { minLength: 1, maxLength: 3 })
    .map((a) => a.join('')),
});
export type Step = {
  op: number;
  a: number;
  b: number;
  c: number;
  text: string;
};
type Node = { type: string; text?: string; children?: Node[] };
function positions(snapshot: Snapshot) {
  const texts: { path: number[]; text: string }[] = [];
  const points: Position[] = [];
  const walk = (node: Node, path: number[]) => {
    if (node.type === 'text') {
      texts.push({ path, text: node.text ?? '' });
      let offset = 0;
      points.push({ path, offset, type: 'text' });
      for (const char of node.text ?? '') {
        offset += char.length;
        points.push({ path, offset, type: 'text' });
      }
    } else if (node.children) {
      for (let offset = 0; offset <= node.children.length; offset++)
        points.push({ path, offset, type: 'element' });
      node.children.forEach((n, i) => walk(n, [...path, i]));
    }
  };
  walk((snapshot.state as { root: Node }).root, []);
  return { texts, points };
}
export function generateCommand(s: Step, state: Snapshot): Command {
  const { texts, points } = positions(state);
  const p = (n: number) => points[n % points.length];
  if (s.op < 15) return { kind: 'Select', anchor: p(s.a), focus: p(s.b) };
  if (s.op < 35 && texts.length) {
    const t = texts[s.a % texts.length];
    const offsets = [0];
    for (const c of t.text) offsets.push(offsets.at(-1)! + c.length);
    const offset = offsets[s.b % offsets.length];
    const text =
      t.text.slice(0, offset) +
      s.text.replaceAll('\n', '').replaceAll('\t', '') +
      t.text.slice(offset);
    const end =
      offset + s.text.replaceAll('\n', '').replaceAll('\t', '').length;
    return {
      kind: 'TextFromView',
      path: t.path,
      text,
      anchor: end,
      focus: end,
      compositionEnd: s.c % 10 === 0,
    };
  }
  if (s.op < 40)
    return { kind: 'SelectionFromView', anchor: p(s.a), focus: p(s.b) };
  if (s.op < 60) return { kind: 'InsertText', text: s.text };
  if (s.op < 70) return { kind: 'RemoveText' };
  if (s.op < 80) return { kind: 'InsertParagraph' };
  if (s.op < 86) return { kind: 'InsertLineBreak' };
  if (s.op < 90) return { kind: 'InsertTab' };
  if (s.op < 95) return { kind: 'InsertRawText', text: s.text };
  return {
    kind: 'FormatText',
    format: (
      [
        'bold',
        'italic',
        'underline',
        'strikethrough',
        'code',
        'subscript',
        'superscript',
        'highlight',
        'lowercase',
        'uppercase',
        'capitalize',
      ] as const
    )[s.a % 11],
  };
}
