import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import {
  ContextMenuContent,
  ContextMenuTrigger,
} from '@core/component/ContextMenu';
import { touchHandler } from '@core/directive/touchHandler';
import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import { cn } from '@ui';
import {
  type Accessor,
  createSignal,
  type FlowComponent,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { getSoupMenuEntities } from './collection/rows';
import { useSoupEntityActionDrawer } from './SoupEntityActionDrawerContext';
import { SoupEntityActionsMenu } from './SoupEntityActionsMenu';
import {
  createSoupEntityMenuPickers,
  type SoupEntityMenuAnchor,
} from './SoupEntityMenuPickers';

interface SoupEntityContextMenuProps {
  entity: EntityData;
  list: EntityActionListState;
  selectedEntities: Accessor<EntityData[]>;
  viewContext: EntityActionViewContext;
  class?: string;
  /** Use a div trigger when the row already renders its own button. */
  as?: 'div';
  onOpenChange?: (open: boolean) => void;
  /**
   * View-specific items appended after the entity actions, separated from
   * them. Desktop only: the mobile long-press drawer shows the actions alone.
   */
  extraItems?: JSX.Element;
}

export const SoupEntityContextMenu: FlowComponent<
  SoupEntityContextMenuProps
> = (props) => {
  const drawerManager = useSoupEntityActionDrawer();
  const [menuPosition, setMenuPosition] = createSignal<SoupEntityMenuAnchor>();

  const menuEntities = () =>
    getSoupMenuEntities(props.entity, props.selectedEntities());

  const pickers = createSoupEntityMenuPickers({
    entity: () => props.entity,
    entities: menuEntities,
    anchor: menuPosition,
  });

  return (
    <Switch>
      <Match when={isMobile()}>
        <div
          class={cn('h-full w-full', props.class)}
          data-soup-entity
          ref={(el) => {
            touchHandler(el, () => ({
              onLongPress: () => {
                props.onOpenChange?.(true);
                drawerManager?.open({
                  entity: props.entity,
                  list: props.list,
                  viewContext: props.viewContext,
                });
              },
            }));
          }}
        >
          {props.children}
        </div>
      </Match>
      <Match when={true}>
        <ContextMenu onOpenChange={props.onOpenChange}>
          <ContextMenuTrigger
            as={props.as}
            class={cn('h-full w-full group/cm-trigger', props.class)}
            on:contextmenu={(event: MouseEvent) =>
              setMenuPosition({ x: event.clientX, y: event.clientY })
            }
          >
            {props.children}
          </ContextMenuTrigger>
          <ContextMenu.Portal>
            <Show when={props.entity}>
              <ContextMenuContent class="w-64 text-xs text-ink-muted">
                <SoupEntityActionsMenu
                  entities={menuEntities()}
                  list={props.list}
                  viewContext={props.viewContext}
                  onSetProject={pickers.openProjectPicker}
                  onEditTags={pickers.openTagPicker()}
                  extraItems={props.extraItems}
                />
              </ContextMenuContent>
            </Show>
          </ContextMenu.Portal>
        </ContextMenu>
        <pickers.Pickers />
      </Match>
    </Switch>
  );
};
