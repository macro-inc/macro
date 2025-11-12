import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useMaybeBlockId } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { createCallback } from '@solid-primitives/rootless';
import type { ParentProps } from 'solid-js';
import { useSplitLayout } from '../../../../../app/component/split-layout/layout';

export const blockNamesWithLocations = [
  'pdf',
  'canvas',
  'channel',
  'md',
] as const;
export type BlockNameWithLocations = (typeof blockNamesWithLocations)[number];

function isBlockNameWithLocation(name: string): name is BlockNameWithLocations {
  return blockNamesWithLocations.includes(name as BlockNameWithLocations);
}

export async function openLocation<T extends BlockNameWithLocations>(
  _blockName: T,
  id: string,
  params?: Record<string, string>
): Promise<void> {
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const blockHandle = await blockOrchestrator.getBlockHandle(id);
  await blockHandle?.goToLocationFromParams(params ?? {});
}

export function openDocument(
  blockOrFileType: string,
  id: string,
  params?: Record<string, string>,
  inNewSplit?: boolean
) {
  const currentBlockId = useMaybeBlockId();
  const { replaceOrInsertSplit, insertSplit } = useSplitLayout();

  const targetBlock = fileTypeToBlockName(blockOrFileType);
  if (!targetBlock) return;

  if (
    currentBlockId === id &&
    params &&
    Object.keys(params).length > 0 &&
    isBlockNameWithLocation(targetBlock) &&
    !inNewSplit
  ) {
    openLocation(targetBlock, id, params);
    return;
  }

  if (inNewSplit) {
    const handle = insertSplit({
      type: targetBlock,
      id,
    });
    handle?.activate();
  } else {
    const handle = replaceOrInsertSplit({
      type: targetBlock,
      id,
    });
    handle?.activate();
  }

  if (isBlockNameWithLocation(targetBlock)) {
    openLocation(targetBlock, id, params);
  }
}

export function BlockLink(
  props: ParentProps<{
    blockOrFileName: string;
    id: string;
    params?: Record<string, string>;
  }>
) {
  const open = createCallback((e: MouseEvent) => {
    let newSplit = e.altKey;
    openDocument(props.blockOrFileName, props.id, props.params, newSplit);
  });
  return (
    <span
      onMouseDown={(e) => {
        // Prevent focus change on mousedown to avoid split activation flash
        // The click handler will properly handle navigation
        e.preventDefault();
      }}
      onClick={open}
    >
      {props.children}
    </span>
  );
}
