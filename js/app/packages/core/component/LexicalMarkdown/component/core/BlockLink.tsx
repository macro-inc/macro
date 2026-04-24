import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { useMaybeBlockId, type BlockName, type BlockAlias } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { createCallback } from '@solid-primitives/rootless';
import type { ParentProps } from 'solid-js';

export const blockNamesWithLocations = [
  'pdf',
  'canvas',
  'channel',
  'md',
  'task',
  'email',
  'chat',
  'task',
] as const;
export type BlockNameWithLocations = (typeof blockNamesWithLocations)[number];

export function isBlockNameWithLocation(
  name: BlockName | BlockAlias
): name is BlockNameWithLocations {
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
  const { openWithSplit } = useSplitLayout();

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

  openWithSplit({ type: targetBlock, id }, { preferNewSplit: inNewSplit });

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
    let newSplit = e.shiftKey;
    openDocument(props.blockOrFileName, props.id, props.params, newSplit);
  });
  const navHandlers = useSplitNavigationHandler<HTMLSpanElement>(open);
  return <span {...navHandlers}>{props.children}</span>;
}
