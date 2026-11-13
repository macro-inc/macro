import {
  type BlockAlias,
  type BlockName,
  useBlockAliasedName,
} from '@core/block';
import type { Permissions } from '@core/component/SharePermissions';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useGetPermissions } from '@core/signal/permissions';
import type { EntityData } from '@entity';
import type { ItemType } from '@service-storage/client';
import { Button, ButtonGroup, cn } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { HeaderActionGroup } from './HeaderActionGroup';
import { SidePanel } from './side-panel';
import { HeaderIsland } from './split-layout/components/HeaderIsland';
import {
  type FileOperation,
  SplitFileMenu,
} from './split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from './split-layout/components/SplitHeader';
import {
  AccessBadge,
  SplitPermissionsBadge,
  SplitTitleFileMenu,
} from './split-layout/components/SplitLabel';
import type {
  SplitFileMenuAction,
  SplitFileMenuActionGroup,
} from './split-layout/context';

export type BlockTool = {
  label: string | (() => string);
  icon: Component;
  action: () => void;
  children?: SplitFileMenuAction[];
  condition?: () => boolean;
  isActive?: () => boolean;
  buttonComponent?: Component<{ grouped?: boolean }>;
  focusTarget?: () => HTMLElement | null;
  hotkeyToken?: HotkeyToken;
  /** Menu section this tool renders in when shown in the title file menu. */
  group?: SplitFileMenuActionGroup;
};

export function ToolButton(props: { tool: BlockTool; grouped?: boolean }) {
  const label = () =>
    typeof props.tool.label === 'function'
      ? props.tool.label()
      : props.tool.label;

  const Control = props.grouped ? ButtonGroup.Button : Button;
  return (
    <Control
      variant="ghost"
      aria-label={label()}
      tooltip={{ content: label(), hotkey: props.tool.hotkeyToken }}
      onClick={props.tool.action}
      class={cn(
        'px-1',
        props.tool.isActive?.() && 'bg-accent/20 hover:bg-accent/30 text-accent'
      )}
      size={isTouchDevice() || props.grouped ? 'icon-sm' : 'icon-md'}
    >
      <Dynamic
        component={
          props.tool.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
        }
        class="size-4 shrink-0 touch:size-3.5"
      />
    </Control>
  );
}

function getToolLabel(tool: BlockTool) {
  return typeof tool.label === 'function' ? tool.label() : tool.label;
}

/** An access badge: after the title island on touch, among actions on desktop. */
function ResponsiveBadge(props: { children: JSX.Element }) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={<SplitHeaderRight>{props.children}</SplitHeaderRight>}
    >
      <SplitHeaderLeft>
        <HeaderIsland>{props.children}</HeaderIsland>
      </SplitHeaderLeft>
    </Show>
  );
}

/** Block-free {@link ResponsivePermissionsBadge}. */
export function ResponsiveAccessBadge(props: {
  canEdit: boolean;
  canComment: boolean;
  canView: boolean;
}) {
  return (
    <Show when={!props.canEdit}>
      <ResponsiveBadge>
        <AccessBadge
          canEdit={props.canEdit}
          canComment={props.canComment}
          canView={props.canView}
        />
      </ResponsiveBadge>
    </Show>
  );
}

/** Reads access from the enclosing legacy Block. */
export function ResponsivePermissionsBadge() {
  return (
    <ResponsiveBadge>
      <SplitPermissionsBadge />
    </ResponsiveBadge>
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

type DocumentToolbarProps = Omit<BlockToolbarProps, 'permissions'> & {
  entityKind: BlockName | BlockAlias;
  permissions: Permissions;
  onDuplicate?: (id: string) => void;
  onDelete?: () => void;
};

/** Reads the entity kind and access from the enclosing legacy Block. */
export function ResponsiveBlockToolbar(props: BlockToolbarProps) {
  const entityKind = useBlockAliasedName();
  const permissions = useGetPermissions();
  return (
    <ResponsiveDocumentToolbar
      {...props}
      entityKind={entityKind}
      permissions={props.permissions ?? permissions()}
    />
  );
}

/**
 * Handles the standard arrangement of file ops and block tools on desktop and
 * mobile. On mobile, they are condensed together into a dropdown menu in the
 * SplitHeader. Block-free; {@link ResponsiveBlockToolbar} adapts it.
 */
export function ResponsiveDocumentToolbar(props: DocumentToolbarProps) {
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
  const activeToolbarTools = () =>
    toolbarTools().filter((tool) => !tool.condition || tool.condition());
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
        <>
          <SplitHeaderRight>
            <div class="order-[1000] flex items-center gap-2">
              <Show when={activeToolbarTools().length > 0}>
                <HeaderActionGroup label="Document actions">
                  <For each={activeToolbarTools()}>
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
            </div>
          </SplitHeaderRight>
          <SplitTitleFileMenu>
            <SplitFileMenu
              id={props.id}
              itemType={props.itemType}
              name={props.name}
              formattedName={props.formattedName}
              ops={props.ops}
              tools={fileMenuTools()}
              entity={props.entity}
              entityKind={props.entityKind}
              permissions={props.permissions}
              onDuplicate={props.onDuplicate}
              onDelete={props.onDelete}
              buttonClass="order-first"
            />
          </SplitTitleFileMenu>
        </>
      }
    >
      <SplitHeaderRight>
        <HeaderIsland class="has-[[data-side-panel-header-actions]:empty]:hidden">
          <SidePanel.HeaderActionsOutlet />
        </HeaderIsland>
      </SplitHeaderRight>
      <SplitTitleFileMenu>
        <SplitFileMenu
          id={props.id}
          itemType={props.itemType}
          name={props.name}
          formattedName={props.formattedName}
          ops={props.ops}
          tools={fileMenuTools()}
          entity={props.entity}
          entityKind={props.entityKind}
          permissions={props.permissions}
          onDuplicate={props.onDuplicate}
          onDelete={props.onDelete}
          buttonClass="order-last"
        />
      </SplitTitleFileMenu>
    </Show>
  );
}
