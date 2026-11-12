import type { Permissions } from '@core/component/SharePermissions';
import type { EntityData } from '@entity';
import type { ItemType } from '@service-storage/client';
import { For, type JSX, Show } from 'solid-js';
import type { BlockTool } from './block-tool';
import { HeaderActionGroup } from './HeaderActionGroup';
import { SidePanel } from './side-panel';
import {
  BlockSplitFileMenu,
  type FileOperation,
} from './split-layout/components/SplitFileMenu';
import { SplitHeaderRight } from './split-layout/components/SplitHeader';
import { SplitTitleFileMenu } from './split-layout/components/SplitLabel';
import { ToolButton } from './tool-button';

/**
 * The standard desktop arrangement of a block's header: its tools in one
 * group, the side panel's header actions, then `trailing` (Share), with the
 * title menu before the title.
 */
export function BlockToolbar(props: {
  /** Buttons for the "Document actions" group, in order. */
  tools?: BlockTool[];
  /** Controls after the side panel's header actions, such as Share. */
  trailing?: JSX.Element;
  /** Title menu rows, before the shared entity actions and `ops`. */
  menuTools: BlockTool[];
  ops: FileOperation[];
  id: string;
  itemType: ItemType;
  name: string;
  formattedName?: string;
  /**
   * Full entity for the title menu's entity-gated items. Supply it when the
   * block can build one that generic chrome can't reconstruct from
   * id/name/blockName alone (e.g. calls need their channelId).
   */
  entity?: EntityData;
  /** Feature-owned access when the session loads outside legacy Block state. */
  permissions?: Permissions;
}) {
  const activeTools = () =>
    (props.tools ?? []).filter((tool) => !tool.condition || tool.condition());

  return (
    <>
      <SplitHeaderRight>
        <div class="order-[1000] flex items-center gap-2">
          <Show when={activeTools().length > 0}>
            <HeaderActionGroup label="Document actions">
              <For each={activeTools()}>
                {(tool) =>
                  tool.buttonComponent ? (
                    <tool.buttonComponent grouped />
                  ) : (
                    <ToolButton tool={tool} grouped />
                  )
                }
              </For>
            </HeaderActionGroup>
          </Show>
          <SidePanel.HeaderActionsOutlet />
          {props.trailing}
        </div>
      </SplitHeaderRight>
      <SplitTitleFileMenu>
        <BlockSplitFileMenu
          id={props.id}
          itemType={props.itemType}
          name={props.name}
          formattedName={props.formattedName}
          ops={props.ops}
          tools={props.menuTools}
          entity={props.entity}
          permissions={props.permissions}
          buttonClass="order-first"
        />
      </SplitTitleFileMenu>
    </>
  );
}
