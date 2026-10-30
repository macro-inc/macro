import { readEntityAppearance } from '@app/features/entity-appearance/core/appearance';
import { EntityAppearanceTrigger } from '@app/features/entity-appearance/entity-appearance';
import { useDocumentAppearance } from '@app/features/entity-appearance/queries/document-appearance';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName, useBlockId, useBlockName } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { useUserId } from '@core/context/user';
import { blockMetadataSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import type { DocumentEntity } from '@entity';
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
  const userId = useUserId();
  const canEdit = useCanEdit();
  const appearanceEntity = (): DocumentEntity | undefined => {
    const metadata = blockMetadataSignal();
    if (
      !metadata ||
      metadata.fileType !== 'md' ||
      (metadata.subType && metadata.subType !== 'snippet')
    )
      return;
    return {
      type: 'document',
      id: metadata.documentId,
      name: name() ?? metadata.documentName,
      ownerId: metadata.owner,
      fileType: 'md',
      subType: metadata.subType === 'snippet' ? { type: 'snippet' } : null,
      appearance: readEntityAppearance(
        'appearance' in metadata ? metadata.appearance : undefined
      ),
    };
  };
  const appearance = useDocumentAppearance(appearanceEntity, () =>
    Boolean(userId())
  );
  const headerEntity = () => {
    const entity = appearanceEntity();
    return entity && { ...entity, appearance: appearance() };
  };

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel
          name={name}
          icon={
            <Show when={headerEntity()}>
              {(entity) => (
                <EntityAppearanceTrigger
                  entity={entity()}
                  editable={canEdit()}
                />
              )}
            </Show>
          }
        />
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
        entity={headerEntity()}
      />
    </>
  );
}
