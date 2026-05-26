import { ContextMenuContent } from '@core/component/ContextMenu';
import { longPressHighlight } from '@core/directive/longPressHighlight';
import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import { type FlowComponent, Match, Show, Switch } from 'solid-js';
import { useSoupEntityActionDrawer } from './soup-entity-action-drawer-context';
import { SoupEntityActionsMenu } from './soup-entity-actions-menu';
import { useSoupView } from './soup-view-context';

interface SoupEntityContextMenuProps {
  entity: EntityData;
  onOpenChange?: (open: boolean) => void;
}

export const SoupEntityContextMenu: FlowComponent<
  SoupEntityContextMenuProps
> = (props) => {
  const { soup } = useSoupView();
  const drawerManager = useSoupEntityActionDrawer();

  return (
    <Switch>
      <Match when={isMobile()}>
        <div
          class="size-full"
          data-soup-entity
          ref={(el) =>
            longPressHighlight(el, () => ({
              onLongPress: () => drawerManager?.open(props.entity, soup),
            }))
          }
        >
          {props.children}
        </div>
      </Match>
      <Match when={true}>
        <ContextMenu onOpenChange={props.onOpenChange}>
          <ContextMenu.Trigger class="size-full group/cm-trigger">
            {props.children}
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <Show when={props.entity}>
              {(selectedEntity) => (
                <ContextMenuContent class="text-xs text-ink-muted">
                  <SoupEntityActionsMenu
                    entities={[selectedEntity()]}
                    soup={soup}
                  />
                </ContextMenuContent>
              )}
            </Show>
          </ContextMenu.Portal>
        </ContextMenu>
      </Match>
    </Switch>
  );
};
