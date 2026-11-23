/**
 * What a finding is about, worked out from its detail, so that findings of
 * one kind and shape can be counted together and looked for again.
 */
import type { Finding } from './run';

const KEY = /q\d+([mp]\d+) v(\d+)/;

/** One side of a finding's detail, as message → its line and its replies. */
function sideOf(
  text: string
): Map<string, { line: string; replies: string[] }> {
  const out = new Map<string, { line: string; replies: string[] }>();
  if (text.trim() === '(nothing)') return out;
  for (const block of text.split(' | ')) {
    const [line, ...replies] = block.split(' ⏎').map((part) => part.trim());
    const key = KEY.exec(line)?.[1] ?? line;
    out.set(key, {
      line,
      replies: replies.map((reply) => reply.replace(/^> /, '')),
    });
  }
  return out;
}

/**
 * What a finding is about, from its detail: which of a missing message, one
 * too many, another text, other reactions, a reply missing or too many, or
 * another order. Findings of one kind and shape are counted together.
 */
export function shapeOf(finding: Finding): string {
  const { detail } = finding;
  if (detail.includes('same messages in another order')) return 'order';
  const found = /only (\w+): (.*) ;; only (\w+): (.*)$/.exec(detail);
  if (!found) return detail.includes('could not be read') ? 'unreadable' : '';
  const [, , left, right, rightText] = [
    found[0],
    found[1],
    found[2],
    found[3],
    found[4],
  ];
  const [a, b] = [sideOf(left), sideOf(rightText)];
  const other = right;
  const shapes = new Set<string>();
  const version = (line: string) => KEY.exec(line)?.[2];
  const bare = (line: string) => line.replace(/ \[.*\]$/, '');
  const compare = (mine: string, theirs: string) => {
    if (version(mine) !== version(theirs)) shapes.add('another text');
    else if (bare(mine) === bare(theirs) && mine !== theirs) {
      shapes.add('other reactions');
    }
  };
  for (const [key, mine] of a) {
    const theirs = b.get(key);
    if (!theirs) {
      shapes.add(
        `a message the ${other} do not have`.replace('model do', 'model does')
      );
      continue;
    }
    compare(mine.line, theirs.line);
    const keys = (replies: string[]) =>
      replies.map((reply) => KEY.exec(reply)?.[1] ?? reply);
    const [mineKeys, theirKeys] = [keys(mine.replies), keys(theirs.replies)];
    if (mineKeys.some((reply) => !theirKeys.includes(reply)))
      shapes.add('a reply too many');
    if (theirKeys.some((reply) => !mineKeys.includes(reply)))
      shapes.add('a reply missing');
    mine.replies.forEach((reply, index) => {
      const same = theirKeys.indexOf(mineKeys[index]);
      if (same !== -1) compare(reply, theirs.replies[same]);
    });
    if (
      mineKeys.length === theirKeys.length &&
      mineKeys.join() !== theirKeys.join() &&
      [...mineKeys].sort().join() === [...theirKeys].sort().join()
    ) {
      shapes.add('replies in another order');
    }
  }
  for (const key of b.keys()) {
    if (!a.has(key)) shapes.add('a message missing');
  }
  return [...shapes].sort().join(', ');
}

/** A finding's name in reports: its kind, and its shape when it has one. */
export function nameOf(finding: Finding): string {
  const shape = shapeOf(finding);
  return shape ? `${finding.kind}: ${shape}` : finding.kind;
}

/** Whether a finding is the one asked for, by kind or by kind and shape. */
export function isOne(finding: Finding, wanted: string): boolean {
  return (
    wanted === 'any' || finding.kind === wanted || nameOf(finding) === wanted
  );
}
