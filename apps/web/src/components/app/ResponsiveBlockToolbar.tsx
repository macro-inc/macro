import type { Permissions } from '@core/component/SharePermissions';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EntityData } from '@entity';
import type { ItemType } from '@service-storage/client';
import { For, Show } from 'solid-js';
import type { BlockTool } from './block-tool';
import { BlockToolbar } from './block-toolbar';
import { SidePanel } from './side-panel';
import { HeaderIsland } from './split-layout/components/HeaderIsland';
import {
  BlockSplitFileMenu,
  type FileOperation,
} from './split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from './split-layout/components/SplitHeader';
import {
  SplitPermissionsBadge,
  SplitTitleFileMenu,
} from './split-layout/components/SplitLabel';
import { ToolButton } from './tool-button';

export type { BlockTool };

function getToolLabel(tool: BlockTool) {
  return typeof tool.label === 'function' ? tool.label() : tool.label;
}

export function ResponsivePermissionsBadge() {
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <SplitHeaderRight>
          <SplitPermissionsBadge />
        </SplitHeaderRight>
      }
    >
      <SplitHeaderLeft>
        <HeaderIsland>
          <SplitPermissionsBadge />
        </HeaderIsland>
      </SplitHeaderLeft>
    </Show>
  );
}

interface BlockToolbarProps {
  tools: BlockTool[];
  menuTools?: BlockTool[];
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
}

/**
 * Legacy header arrangement for blocks whose header one component builds for
 * both desktop and touch. A block that has a desktop and a mobile view uses
 * `BlockToolbar` in one and `MobileHeader` in the other instead.
 */
export function ResponsiveBlockToolbar(props: BlockToolbarProps) {
  const isShareTool = (tool: BlockTool) => getToolLabel(tool) === 'Share';
  const isHiddenTool = (tool: BlockTool) => {
    const label = getToolLabel(tool);
    return (
      label === 'Chat' ||
      label === 'Dispatch to Agent' ||
      label === 'References'
    );
  };
  const visibleTools = () => props.tools.filter((tool) => !isHiddenTool(tool));
  const headerTools = () => visibleTools().filter(isShareTool);
  const toolbarTools = () =>
    visibleTools().filter((tool) => !isShareTool(tool));
  const fileMenuTools = () => {
    if (!props.menuTools) return visibleTools();

    const menuToolLabels = new Set(props.menuTools.map(getToolLabel));
    const missingShareTools = visibleTools().filter(
      (tool) => isShareTool(tool) && !menuToolLabels.has(getToolLabel(tool))
    );

    return [...props.menuTools, ...missingShareTools];
  };

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <BlockToolbar
          tools={toolbarTools()}
          trailing={
            <For each={headerTools()}>
              {(tool) => (
                <Show when={!tool.condition || tool.condition()}>
                  {tool.buttonComponent ? (
                    <tool.buttonComponent />
                  ) : (
                    <ToolButton tool={tool} />
                  )}
                </Show>
              )}
            </For>
          }
          menuTools={fileMenuTools()}
          ops={props.ops}
          id={props.id}
          itemType={props.itemType}
          name={props.name}
          formattedName={props.formattedName}
          entity={props.entity}
          permissions={props.permissions}
        />
      }
    >
      <SplitHeaderRight>
        <HeaderIsland class="has-[[data-side-panel-header-actions]:empty]:hidden">
          <SidePanel.HeaderActionsOutlet />
        </HeaderIsland>
      </SplitHeaderRight>
      <SplitTitleFileMenu>
        <BlockSplitFileMenu
          id={props.id}
          itemType={props.itemType}
          name={props.name}
          formattedName={props.formattedName}
          ops={props.ops}
          tools={fileMenuTools()}
          entity={props.entity}
          permissions={props.permissions}
          buttonClass="order-last"
        />
      </SplitTitleFileMenu>
    </Show>
  );
}
