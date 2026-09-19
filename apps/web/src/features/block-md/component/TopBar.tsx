import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName, useBlockId, useBlockName } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { blockNameToItemType } from '@service-storage/client';
import { type Accessor, Show } from 'solid-js';
import { useMarkdownDocumentTools } from './useMarkdownDocumentTools';

export function TopBar(props: { name?: Accessor<string | undefined> } = {}) {
  const blockName = useBlockName();
  const blockId = useBlockId();
  const fallbackName = useBlockDocumentName();
  const name = () => props.name?.() ?? fallbackName();
  const itemType = blockNameToItemType(blockName);
  if (!itemType)
    throw new Error('Using functionality in an unknown item type.');

  const blockAliasedName = useBlockAliasedName();
  const isSkill = blockAliasedName === 'skill';
  const { fileOperations, menuTools, tools } = useMarkdownDocumentTools();

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel name={name} />
        <Show when={isSkill}>
          <span class="ml-1.5 inline-flex shrink-0 items-center self-center rounded-sm bg-hover px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink-muted">
            Skill
          </span>
        </Show>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        {/* Hidden on mobile/tablet: no floating-island treatment for live avatars yet. */}
        <div class="-order-1 touch:hidden">
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>

      <ResponsivePermissionsBadge />

      <ResponsiveBlockToolbar
        tools={tools}
        menuTools={menuTools}
        ops={fileOperations}
        id={blockId}
        itemType={itemType}
        name={name()}
      />
    </>
  );
}

export function InstructionsTopBar() {
  return (
    <SplitHeaderLeft>
      <StaticSplitLabel label="AI Instructions" iconType="md" />
    </SplitHeaderLeft>
  );
}
