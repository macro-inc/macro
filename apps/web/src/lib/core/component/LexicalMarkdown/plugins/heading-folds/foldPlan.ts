/**
 * @file Pure section logic for heading folds. A heading's section is every
 * top-level block after it up to the next heading of the same or a higher
 * level (a smaller number). Folding a heading hides its section; a folded
 * heading inside a folded section stays folded underneath. No Lexical or DOM
 * access here so the rules stay unit-testable.
 */

/** One top-level block of the document, in order. */
export type FoldBlock = {
  key: string;
  /** 1–6 for a heading, null for any other block. */
  level: number | null;
};

export type FoldHeading = {
  key: string;
  folded: boolean;
  /** Whether the heading is itself inside a folded section. */
  hidden: boolean;
};

export type FoldPlan = {
  /** Headings with a non-empty section, the ones that can fold. */
  headings: FoldHeading[];
  /** Keys of the blocks a folded section hides. */
  hidden: string[];
};

export function computeFoldPlan(
  blocks: FoldBlock[],
  isFolded: (key: string) => boolean
): FoldPlan {
  const headings: FoldHeading[] = [];
  const hidden: string[] = [];
  // Level of the outermost folded heading whose section we are inside.
  let foldLevel = Number.POSITIVE_INFINITY;

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];

    if (block.level !== null && block.level <= foldLevel) {
      foldLevel = Number.POSITIVE_INFINITY;
    }

    const isHidden = foldLevel !== Number.POSITIVE_INFINITY;
    if (isHidden) hidden.push(block.key);

    if (block.level === null) continue;

    const next = blocks[index + 1];
    const hasSection =
      next !== undefined && (next.level === null || next.level > block.level);
    if (!hasSection) continue;

    const folded = isFolded(block.key);
    headings.push({ key: block.key, folded, hidden: isHidden });
    if (folded && !isHidden) foldLevel = block.level;
  }

  return { headings, hidden };
}

/**
 * The headings whose sections contain the block at `index`, innermost first:
 * walking back, each earlier heading with a lower level than the last one
 * found opens an enclosing section.
 */
export function enclosingHeadings(blocks: FoldBlock[], index: number) {
  const keys: string[] = [];
  let level = blocks[index]?.level ?? Number.POSITIVE_INFINITY;

  for (let i = index - 1; i >= 0 && level > 1; i--) {
    const block = blocks[i];
    if (block.level === null || block.level >= level) continue;
    keys.push(block.key);
    level = block.level;
  }

  return keys;
}
