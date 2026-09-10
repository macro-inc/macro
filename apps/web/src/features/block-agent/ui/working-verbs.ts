/**
 * The words an open turn shows while the agent has produced nothing to read.
 *
 * Modelled on Claude Code's spinner corpus, but off paper rather than out of a
 * kitchen, because that is the work this agent does.
 */

export const VERBS: readonly string[] = [
  'Skimming',
  'Poring',
  'Leafing',
  'Combing',
  'Sifting',
  'Thumbing',
  'Excerpting',
  'Pondering',
  'Puzzling',
  'Mulling',
  'Percolating',
  'Weighing',
  'Reconsidering',
  'Drafting',
  'Wordsmithing',
  'Redlining',
  'Tightening',
  'Annotating',
  'Collating',
  'Threading',
  'Indexing',
  'Cross-referencing',
];

/**
 * The word an open turn shows before its first rotation, and the label a
 * screen reader hears for the whole turn. Deliberately not "Thinking": a bare
 * row has no reasoning behind it and the turn may well be running a tool.
 */
export const WORKING_LABEL = 'Working';

/**
 * A draw that does not repeat until every verb has been used.
 *
 * Repetition is the one thing that makes a rotation look cheap, so the list is
 * drawn down and reshuffled rather than sampled.
 */
export function createVerbDraw(
  random: () => number = Math.random
): () => string {
  let remaining: string[] = [];

  return () => {
    if (remaining.length === 0) remaining = shuffled(VERBS, random);
    return remaining.pop() ?? WORKING_LABEL;
  };
}

function shuffled(pool: readonly string[], random: () => number): string[] {
  const out = [...pool];
  for (let index = out.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap] as string, out[index] as string];
  }
  return out;
}
