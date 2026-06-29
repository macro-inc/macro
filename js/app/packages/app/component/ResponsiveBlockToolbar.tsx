import type { HotkeyToken } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import type { ItemType } from '@service-storage/client';
import { Button, cn } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
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
  SplitPermissionsBadge,
  SplitTitleFileMenu,
} from './split-layout/components/SplitLabel';
import { SplitToolbarRight } from './split-layout/components/SplitToolbar';

export type BlockTool = {
  label: string | (() => string);
  icon: Component;
  action: () => void;
  condition?: () => boolean;
  isActive?: () => boolean;
  buttonComponent?: () => JSX.Element;
  focusTarget?: () => HTMLElement | null;
  hotkeyToken?: HotkeyToken;
};

export function ToolButton(props: { tool: BlockTool }) {
  const label = () =>
    typeof props.tool.label === 'function'
      ? props.tool.label()
      : props.tool.label;

  return (
    <Button
      onClick={props.tool.action}
      label={label()}
      hotkey={props.tool.hotkeyToken}
      class={cn(
        'px-1',
        props.tool.isActive?.() && 'bg-accent/20 hover:bg-accent/30 text-accent'
      )}
      size="icon-sm"
    >
      <Dynamic
        component={
          props.tool.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
        }
      />
    </Button>
  );
}

function getToolLabel(tool: BlockTool) {
  return typeof tool.label === 'function' ? tool.label() : tool.label;
}

export function ResponsivePermissionsBadge() {
  return (
    <Show
      when={isMobile()}
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
  ops: FileOperation[];
  id: string;
  itemType: ItemType;
  name: string;
  formattedName?: string;
}

/**
 * Handles the standard arrangement of file ops and block tools on desktop and mobile. On mobile, they are condensed together into a dropdown menu in the SplitHeader.
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
  const activeToolbarTools = () =>
    toolbarTools().filter((tool) => !tool.condition || tool.condition());

  return (
    <Show
      when={isMobile()}
      fallback={
        <>
          <SplitHeaderRight>
            <div class="order-[1000] flex items-center gap-1">
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
          <Show when={props.ops.length > 0}>
            <SplitTitleFileMenu>
              <SplitFileMenu
                id={props.id}
                itemType={props.itemType}
                name={props.name}
                formattedName={props.formattedName}
                ops={props.ops}
                buttonClass="order-first"
              />
            </SplitTitleFileMenu>
          </Show>
          <Show when={activeToolbarTools().length > 0}>
            <SplitToolbarRight>
              <For each={activeToolbarTools()}>
                {(tool) => (
                  <>
                    {tool.buttonComponent ? (
                      <tool.buttonComponent />
                    ) : (
                      <ToolButton tool={tool} />
                    )}
                  </>
                )}
              </For>
            </SplitToolbarRight>
          </Show>
        </>
      }
    >
      <SplitTitleFileMenu>
        <Show when={props.ops.length > 0}>
          <SplitFileMenu
            id={props.id}
            itemType={props.itemType}
            name={props.name}
            formattedName={props.formattedName}
            ops={props.ops}
            tools={visibleTools()}
            buttonClass="order-last"
          />
        </Show>
      </SplitTitleFileMenu>
    </Show>
  );
}
