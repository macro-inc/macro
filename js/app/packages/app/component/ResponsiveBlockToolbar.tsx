import { LabelAndHotKey } from '@core/component/Tooltip';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import type { ItemType } from '@service-storage/client';
import { Button, cn } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type FileOperation,
  SplitFileMenu,
} from './split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from './split-layout/components/SplitHeader';
import { SplitPermissionsBadge } from './split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from './split-layout/components/SplitToolbar';

export type BlockTool = {
  label: string | (() => string);
  icon: Component;
  action: () => void;
  condition?: () => boolean;
  isActive?: () => boolean;
  buttonComponent?: () => JSX.Element;
  focusTarget?: () => HTMLElement | null;
  divideAbove?: boolean;
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
      tooltip={
        props.tool.hotkeyToken ? (
          <LabelAndHotKey
            label={label()}
            hotkeyToken={props.tool.hotkeyToken}
          />
        ) : (
          label()
        )
      }
      class={cn(
        'px-1',
        props.tool.isActive?.() &&
          'bg-accent/20 hover:bg-accent/30 text-accent-ink'
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
        <SplitPermissionsBadge />
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
  return (
    <Show
      when={isMobile()}
      fallback={
        <>
          <Show when={props.ops.length > 0}>
            <SplitToolbarLeft>
              <SplitFileMenu
                id={props.id}
                itemType={props.itemType}
                name={props.name}
                formattedName={props.formattedName}
                ops={props.ops}
                buttonClass="order-first"
              />
            </SplitToolbarLeft>
          </Show>
          <SplitToolbarRight>
            <For each={props.tools}>
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
          </SplitToolbarRight>
        </>
      }
    >
      <SplitHeaderRight>
        <SplitFileMenu
          id={props.id}
          itemType={props.itemType}
          name={props.name}
          formattedName={props.formattedName}
          ops={props.ops}
          tools={props.tools}
          buttonClass="order-last"
        />
      </SplitHeaderRight>
    </Show>
  );
}
