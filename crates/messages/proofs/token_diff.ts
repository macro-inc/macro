// A unified diff of two token lists, for the audit failures printed by
// check_delayed_writers.ts.
//
// Blocks are matched longest-first (Ratcliff/Obershelp): the longest common
// run is fixed, then the lists on each side of it are matched the same way.
// In a list of 200 tokens or more, a token making up over 1% of it never
// starts a match, though matches still extend across such tokens.

/** A run of `size` equal tokens at `left` in one list and `right` in the other. */
type Block = { left: number; right: number; size: number };

/** One edit step over `[leftStart, leftEnd)` and `[rightStart, rightEnd)`. */
type Step = {
  tag: 'equal' | 'replace' | 'delete' | 'insert';
  leftStart: number;
  leftEnd: number;
  rightStart: number;
  rightEnd: number;
};

const CONTEXT = 3;

// Where each token occurs in `right`, without the tokens too common to anchor
// a match.
function anchorPositions(right: string[]): Map<string, number[]> {
  const positions = new Map<string, number[]>();

  for (const [index, token] of right.entries()) {
    const known = positions.get(token);
    if (known) {
      known.push(index);
    } else {
      positions.set(token, [index]);
    }
  }

  if (right.length >= 200) {
    const limit = Math.floor(right.length / 100) + 1;
    for (const [token, indices] of positions) {
      if (indices.length > limit) {
        positions.delete(token);
      }
    }
  }

  return positions;
}

// The longest run common to left[leftLow..leftHigh) and
// right[rightLow..rightHigh); of equally long runs, the one starting earliest
// in `left`, then earliest in `right`.
function longestMatch(
  left: string[],
  right: string[],
  anchors: Map<string, number[]>,
  bounds: [number, number, number, number]
): Block {
  const [leftLow, leftHigh, rightLow, rightHigh] = bounds;
  let best: Block = { left: leftLow, right: rightLow, size: 0 };

  // runLengths maps an index in `right` to the length of the common run that
  // ends there and at the current index in `left`.
  let runLengths = new Map<number, number>();
  for (let index = leftLow; index < leftHigh; index += 1) {
    const nextLengths = new Map<number, number>();

    for (const position of anchors.get(left[index] ?? '') ?? []) {
      if (position < rightLow) {
        continue;
      }
      if (position >= rightHigh) {
        break;
      }

      const size = (runLengths.get(position - 1) ?? 0) + 1;
      nextLengths.set(position, size);
      if (size > best.size) {
        best = { left: index - size + 1, right: position - size + 1, size };
      }
    }

    runLengths = nextLengths;
  }

  // Extend over equal tokens on both sides, including the common tokens that
  // could not start the match.
  while (
    best.left > leftLow &&
    best.right > rightLow &&
    left[best.left - 1] === right[best.right - 1]
  ) {
    best = { left: best.left - 1, right: best.right - 1, size: best.size + 1 };
  }
  while (
    best.left + best.size < leftHigh &&
    best.right + best.size < rightHigh &&
    left[best.left + best.size] === right[best.right + best.size]
  ) {
    best.size += 1;
  }

  return best;
}

// Every matching block in order, adjacent blocks merged, ending with an empty
// block at the end of both lists.
function matchingBlocks(left: string[], right: string[]): Block[] {
  const anchors = anchorPositions(right);
  const pending: [number, number, number, number][] = [
    [0, left.length, 0, right.length],
  ];
  const found: Block[] = [];

  for (let bounds = pending.pop(); bounds; bounds = pending.pop()) {
    const [leftLow, leftHigh, rightLow, rightHigh] = bounds;
    const match = longestMatch(left, right, anchors, bounds);
    if (match.size === 0) {
      continue;
    }

    found.push(match);
    if (leftLow < match.left && rightLow < match.right) {
      pending.push([leftLow, match.left, rightLow, match.right]);
    }
    if (
      match.left + match.size < leftHigh &&
      match.right + match.size < rightHigh
    ) {
      pending.push([
        match.left + match.size,
        leftHigh,
        match.right + match.size,
        rightHigh,
      ]);
    }
  }

  found.sort((first, second) => first.left - second.left);

  const merged: Block[] = [];
  let current: Block = { left: 0, right: 0, size: 0 };
  for (const block of found) {
    const adjacent =
      current.left + current.size === block.left &&
      current.right + current.size === block.right;
    if (adjacent) {
      current.size += block.size;
      continue;
    }

    if (current.size > 0) {
      merged.push(current);
    }
    current = { ...block };
  }
  if (current.size > 0) {
    merged.push(current);
  }

  merged.push({ left: left.length, right: right.length, size: 0 });
  return merged;
}

function editSteps(left: string[], right: string[]): Step[] {
  const steps: Step[] = [];
  let leftStart = 0;
  let rightStart = 0;

  for (const block of matchingBlocks(left, right)) {
    const range = {
      leftStart,
      leftEnd: block.left,
      rightStart,
      rightEnd: block.right,
    };
    if (leftStart < block.left && rightStart < block.right) {
      steps.push({ tag: 'replace', ...range });
    } else if (leftStart < block.left) {
      steps.push({ tag: 'delete', ...range });
    } else if (rightStart < block.right) {
      steps.push({ tag: 'insert', ...range });
    }

    leftStart = block.left + block.size;
    rightStart = block.right + block.size;
    if (block.size > 0) {
      steps.push({
        tag: 'equal',
        leftStart: block.left,
        leftEnd: leftStart,
        rightStart: block.right,
        rightEnd: rightStart,
      });
    }
  }

  return steps;
}

// Splits the steps into hunks with up to CONTEXT equal tokens around changes.
function hunks(left: string[], right: string[]): Step[][] {
  const steps = editSteps(left, right);
  const first = steps[0];
  const last = steps.at(-1);
  if (!first || !last) {
    return [];
  }

  if (first.tag === 'equal') {
    first.leftStart = Math.max(first.leftStart, first.leftEnd - CONTEXT);
    first.rightStart = Math.max(first.rightStart, first.rightEnd - CONTEXT);
  }
  if (last.tag === 'equal') {
    last.leftEnd = Math.min(last.leftEnd, last.leftStart + CONTEXT);
    last.rightEnd = Math.min(last.rightEnd, last.rightStart + CONTEXT);
  }

  const groups: Step[][] = [];
  let group: Step[] = [];
  for (const step of steps) {
    const remainder = { ...step };

    // A long equal run ends one hunk with its head and starts the next with
    // its tail.
    if (step.tag === 'equal' && step.leftEnd - step.leftStart > 2 * CONTEXT) {
      group.push({
        ...step,
        leftEnd: Math.min(step.leftEnd, step.leftStart + CONTEXT),
        rightEnd: Math.min(step.rightEnd, step.rightStart + CONTEXT),
      });
      groups.push(group);
      group = [];
      remainder.leftStart = Math.max(step.leftStart, step.leftEnd - CONTEXT);
      remainder.rightStart = Math.max(step.rightStart, step.rightEnd - CONTEXT);
    }

    group.push(remainder);
  }

  const onlyEqual = group.length === 1 && group[0]?.tag === 'equal';
  if (group.length > 0 && !onlyEqual) {
    groups.push(group);
  }

  return groups;
}

function hunkRange(start: number, stop: number): string {
  const length = stop - start;
  if (length === 1) {
    return `${start + 1}`;
  }

  return `${length === 0 ? start : start + 1},${length}`;
}

/**
 * Unified diff lines, one token per line. The two file headers and each hunk
 * header end with a newline of their own; token lines do not.
 */
export function unifiedDiff(
  left: string[],
  right: string[],
  leftName: string,
  rightName: string
): string[] {
  const lines: string[] = [];

  for (const group of hunks(left, right)) {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) {
      continue;
    }

    if (lines.length === 0) {
      lines.push(`--- ${leftName}\n`, `+++ ${rightName}\n`);
    }
    const leftRange = hunkRange(first.leftStart, last.leftEnd);
    const rightRange = hunkRange(first.rightStart, last.rightEnd);
    lines.push(`@@ -${leftRange} +${rightRange} @@\n`);

    for (const step of group) {
      const removed = left.slice(step.leftStart, step.leftEnd);
      const added = right.slice(step.rightStart, step.rightEnd);

      if (step.tag === 'equal') {
        lines.push(...removed.map((token) => ` ${token}`));
        continue;
      }
      if (step.tag !== 'insert') {
        lines.push(...removed.map((token) => `-${token}`));
      }
      if (step.tag !== 'delete') {
        lines.push(...added.map((token) => `+${token}`));
      }
    }
  }

  return lines;
}
