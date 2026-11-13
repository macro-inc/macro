import { useBlockAliasedName, useBlockId } from '@core/block';
import { blockMetadataSignal } from '@core/signal/load';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import type { ItemType } from '@service-storage/client';
import type { JSX } from 'solid-js';
import type { BlockTool } from '../block-tool';
import {
  BlockSplitFileMenu,
  type FileOperation,
} from '../split-layout/components/SplitFileMenu';
import { SplitPermissionsBadge } from '../split-layout/components/SplitLabel';
import { MobileHeader } from './mobile-header';

/**
 * The header of a file block's mobile view: the file's title with its menu,
 * the permissions badge, then `trailing` islands and Info.
 */
export function MobileBlockHeader(props: {
  /** Title menu rows, before the shared entity actions and `ops`. */
  menuTools: BlockTool[];
  ops: FileOperation[];
  itemType?: ItemType;
  fallbackName?: string;
  /** Shown before the file name, such as the file type. */
  badges?: JSX.Element;
  /** Islands after the title, before the permissions badge. */
  children?: JSX.Element;
  /** Islands before Info. */
  trailing?: JSX.Element;
}) {
  const blockId = useBlockId();
  const blockName = useBlockAliasedName();
  const name = useBlockDocumentName(props.fallbackName);
  const iconType = () =>
    blockName === 'unknown'
      ? (blockMetadataSignal()?.fileType ?? blockName)
      : blockName;

  return (
    <>
      <MobileHeader
        trailing={
          <>
            {props.trailing}
            <MobileHeader.Info />
          </>
        }
      >
        <MobileHeader.Title
          class="ph-no-capture"
          iconType={iconType()}
          colorIcon
          badges={props.badges}
          label={name() ?? ''}
        />
        {props.children}
        <MobileHeader.Island>
          <SplitPermissionsBadge />
        </MobileHeader.Island>
      </MobileHeader>

      <BlockSplitFileMenu
        id={blockId}
        itemType={props.itemType ?? 'document'}
        name={name() ?? ''}
        ops={props.ops}
        tools={props.menuTools}
      />
    </>
  );
}
