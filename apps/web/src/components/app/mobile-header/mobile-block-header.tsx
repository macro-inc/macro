import type { BlockAlias, BlockName } from '@core/block';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import type { Permissions } from '@core/component/SharePermissions';
import type { ItemType } from '@service-storage/client';
import type { JSX } from 'solid-js';
import type { BlockTool } from '../block-tool';
import {
  type FileOperation,
  SplitFileMenu,
} from '../split-layout/components/SplitFileMenu';
import { MobileHeader } from './mobile-header';

/**
 * The header of a file block's mobile view: the file's title with its menu,
 * `children` islands, the access badge, then `trailing` islands and Info.
 * The block's view passes in everything it knows about the file, so the
 * header reads no block state.
 */
export function MobileBlockHeader(props: {
  id: string;
  name: string;
  iconType: EntityIconSelector;
  /** The block (or alias) the title menu acts as, such as `pdf` or `csv`. */
  entityKind: BlockName | BlockAlias;
  /** The viewer's access, which decides the title menu's rows. */
  permissions: Permissions;
  /** The access badge, such as `SplitPermissionsBadge`. */
  badge?: JSX.Element;
  /** Title menu rows, before the shared entity actions and `ops`. */
  menuTools: BlockTool[];
  ops: FileOperation[];
  itemType?: ItemType;
  /** Shown before the file name, such as the file type. */
  badges?: JSX.Element;
  /** Islands after the title, before the access badge. */
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
          colorIcon
          badges={props.badges}
          label={props.name}
        />
        {props.children}
        <MobileHeader.Island>{props.badge}</MobileHeader.Island>
      </MobileHeader>

      <SplitFileMenu
        id={props.id}
        entityKind={props.entityKind}
        permissions={props.permissions}
        itemType={props.itemType ?? 'document'}
        name={props.name}
        ops={props.ops}
        tools={props.menuTools}
      />
    </>
  );
}
