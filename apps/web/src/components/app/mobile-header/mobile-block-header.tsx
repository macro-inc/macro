import type { EntityIconSelector } from '@core/component/EntityIcon';
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
 * `children` islands, the permissions badge, then `trailing` islands and Info.
 */
export function MobileBlockHeader(props: {
  id: string;
  name: string;
  /** The name the title menu acts on, when it differs from the title. */
  menuName?: string;
  iconType: EntityIconSelector;
  /** Replaces the entity icon, e.g. the chat's model. */
  icon?: JSX.Element;
  /** Title menu rows, before the shared entity actions and `ops`. */
  menuTools: BlockTool[];
  ops: FileOperation[];
  itemType?: ItemType;
  /** Shown before the file name, such as the file type. */
  badges?: JSX.Element;
  /** Shown after the file name, such as a Beta badge. */
  trailingBadges?: JSX.Element;
  /** Islands after the title, before the permissions badge. */
  children?: JSX.Element;
  /** Islands before Info. */
  trailing?: JSX.Element;
}) {
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
          iconType={props.iconType}
          icon={props.icon}
          colorIcon
          badges={props.badges}
          trailingBadges={props.trailingBadges}
          label={props.name}
        />
        {props.children}
        <MobileHeader.Island>
          <SplitPermissionsBadge />
        </MobileHeader.Island>
      </MobileHeader>

      <BlockSplitFileMenu
        id={props.id}
        itemType={props.itemType ?? 'document'}
        name={props.menuName ?? props.name}
        ops={props.ops}
        tools={props.menuTools}
      />
    </>
  );
}
