import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { isMobile } from '@core/mobile/isMobile';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export * from '../../../../../../features/soup';

/** Keep host entity commands inert; exercise the real rail-specific items. */
export function SoupEntityContextMenu(props: {
  children?: JSX.Element;
  extraItems?: JSX.Element;
  renderAction?: (action: { id: string }, item: JSX.Element) => JSX.Element;
  class?: string;
}) {
  return (
    <Show
      when={!isMobile()}
      fallback={<div class={props.class}>{props.children}</div>}
    >
      <ContextMenu>
        <ContextMenu.Trigger as="div" class={props.class}>
          {props.children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuContent class="min-w-60">
            <MenuItem text="Favorite" />
            <MenuItem text="Mark as read" />
            {props.renderAction?.({ id: 'mute' }, null)}
            <MenuSeparator />
            {props.extraItems}
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    </Show>
  );
}
