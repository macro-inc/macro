import type {
  EntityActionListState,
  EntityActionNavigationHandler,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import { makeAddTagAction } from '@app/features/next-soup/actions';
import type { MarkDoneDelegate } from '@app/features/next-soup/actions/mark-done-delegate';
import {
  ContextMenuContent,
  ContextMenuTrigger,
} from '@core/component/ContextMenu';
import { touchHandler } from '@core/directive/touchHandler';
import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { TreeTag } from '@property/tags/core/tag-tree';
import { DroppedTagApplier } from '@property/tags/DroppedTagApplier';
import { createTagDropTarget } from '@property/tags/tag-drag-and-drop';
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
  /** A list that completes its own rows, such as Home's work feed. */
  markDoneDelegate?: () => MarkDoneDelegate | undefined;
  /** Where the view moves after an action that removes the row (Mark Done). */
  createActionNavigationHandler?: () =>
    | EntityActionNavigationHandler
    | undefined;
  /**
   * The folder the list shows, when the split's content doesn't say so
   * itself (Drive hosts folders inside its own view).
   */
  viewedProjectId?: string;
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

  const addTagAction = makeAddTagAction();
  const canEditTags = () => addTagAction.canExecute(props.entity);
  const [droppedTag, setDroppedTag] = createSignal<{
    tag: TreeTag;
    entities: EntityData[];
  }>();
  // Dropping onto a selected row tags the whole selection, like the menu.
  const tagDropTarget = createTagDropTarget({
    disabled: () => isMobile() || !canEditTags(),
    onDropTag: (tag) =>
      setDroppedTag({
        tag,
        entities: menuEntities().filter(addTagAction.canExecute),
      }),
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
                  markDoneDelegate: props.markDoneDelegate,
                  createActionNavigationHandler:
                    props.createActionNavigationHandler,
                  viewedProjectId: props.viewedProjectId,
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
            ref={(element: HTMLElement) => tagDropTarget?.ref(element)}
            class={cn(
              'h-full w-full group/cm-trigger',
              tagDropTarget?.isOver() &&
                'rounded-xl outline-2 -outline-offset-2 outline-accent',
              props.class
            )}
            on:contextmenu={(event: MouseEvent) =>
              setMenuPosition({ x: event.clientX, y: event.clientY })
            }
          >
            {props.children}
          </ContextMenuTrigger>
          <ContextMenu.Portal>
            <Show when={props.entity}>
              <ContextMenuContent class="min-w-64 max-w-[min(22rem,calc(100vw-1rem))] text-xs text-ink-muted">
                <SoupEntityActionsMenu
                  entities={menuEntities()}
                  list={props.list}
                  viewContext={props.viewContext}
                  onSetProject={pickers.openProjectPicker}
                  onEditTags={pickers.openTagPicker()}
                  extraItems={props.extraItems}
                  markDoneDelegate={props.markDoneDelegate}
                  createActionNavigationHandler={
                    props.createActionNavigationHandler
                  }
                  viewedProjectId={props.viewedProjectId}
                />
              </ContextMenuContent>
            </Show>
          </ContextMenu.Portal>
        </ContextMenu>
        <pickers.Pickers />
        <Show when={droppedTag()} keyed>
          {(drop) => (
            <DroppedTagApplier
              tag={drop.tag}
              entities={drop.entities}
              onDone={() =>
                setDroppedTag((current) =>
                  current === drop ? undefined : current
                )
              }
            />
          )}
        </Show>
      </Match>
    </Switch>
  );
};
