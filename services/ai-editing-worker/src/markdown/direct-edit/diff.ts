/** What an applied (or dry-run) batch changed, block by block. */
import type { DocumentView } from './document';
import { redactMedia } from './media';

export type BlockChange =
  | { kind: 'edited'; blockId: string; before: string; after: string }
  | {
      kind: 'inserted';
      blockId: string;
      afterBlockId: string | null;
      markdown: string;
    }
  | { kind: 'deleted'; blockId: string; markdown: string }
  | { kind: 'moved'; blockId: string; afterBlockId: string | null };

/**
 * The ids in `after` that keep their relative order from `before`: a longest
 * increasing subsequence of their old positions, O(n log n) at any size.
 */
function longestKeptOrder(before: string[], after: string[]): Set<string> {
  const position = new Map(before.map((id, i) => [id, i]));
  const order = after.map((id) => position.get(id) ?? -1);
  // tails[k]: index in `order` ending the best increasing run of length k + 1.
  const tails: number[] = [];
  const previous: number[] = [];
  order.forEach((value, i) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (order[tails[mid]] < value) low = mid + 1;
      else high = mid;
    }
    previous[i] = low > 0 ? tails[low - 1] : -1;
    tails[low] = i;
  });
  const kept = new Set<string>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = previous[i]) kept.add(after[i]);
  return kept;
}

/** Changes from `before` to `after`, matched by block id, in `after`'s order. */
export function blockChanges(
  before: DocumentView,
  after: DocumentView
): BlockChange[] {
  const beforeById = new Map(before.blocks.map((block) => [block.id, block]));
  const afterIds = new Set(after.blocks.map((block) => block.id));
  const keptBefore = before.blocks
    .filter((block) => afterIds.has(block.id))
    .map((block) => block.id);
  const keptAfter = after.blocks
    .filter((block) => beforeById.has(block.id))
    .map((block) => block.id);
  // Blocks outside the longest run kept in their old order moved.
  const stayed = longestKeptOrder(keptBefore, keptAfter);

  const changes: BlockChange[] = [];
  after.blocks.forEach((block, i) => {
    const previous = i > 0 ? after.blocks[i - 1].id : null;
    const old = beforeById.get(block.id);
    if (!old) {
      changes.push({
        kind: 'inserted',
        blockId: block.id,
        afterBlockId: previous,
        markdown: redactMedia(block.markdown),
      });
      return;
    }
    if (!stayed.has(block.id))
      changes.push({
        kind: 'moved',
        blockId: block.id,
        afterBlockId: previous,
      });
    if (old.markdown !== block.markdown)
      changes.push({
        kind: 'edited',
        blockId: block.id,
        before: redactMedia(old.markdown),
        after: redactMedia(block.markdown),
      });
  });
  for (const block of before.blocks)
    if (!afterIds.has(block.id))
      changes.push({
        kind: 'deleted',
        blockId: block.id,
        markdown: redactMedia(block.markdown),
      });
  return changes;
}
