/** What an applied (or dry-run) batch changed, block by block. */
import { blockSteps } from '../body';
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
  // Blocks outside the longest common order of kept ids moved.
  const stayed = new Set<string>();
  for (const step of blockSteps(keptBefore, keptAfter))
    if (step.kind === 'keep') stayed.add(keptBefore[step.current]);

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
