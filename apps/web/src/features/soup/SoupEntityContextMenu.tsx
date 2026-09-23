import {
  type EntityActionListState,
  type EntityActionViewContext,
  makeAddTagAction,
} from '@app/features/next-soup/actions';
import { ContextMenuContent, MenuSeparator } from '@core/component/ContextMenu';
import { touchHandler } from '@core/directive/touchHandler';
import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import {
  TagPickerPopover,
  tagEntityType,
  useSoupDocTags,
} from '@property/tags';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
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
import { useSoupEntityActionDrawer } from './SoupEntityActionDrawerContext';
import { SoupEntityActionsMenu } from './SoupEntityActionsMenu';

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

function RowTagPicker(props: {
  entityId: string;
  entityType: EntityType;
  properties: Accessor<SoupProperty[] | undefined>;
  position: { x: number; y: number } | undefined;
  onClose: () => void;
}) {
  const docTags = useSoupDocTags(
    props.entityId,
    props.entityType,
    props.properties
  );

  return (
    <TagPickerPopover
      docTags={docTags}
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      getAnchorRect={() => props.position}
    />
  );
}

export const SoupEntityContextMenu: FlowComponent<
  SoupEntityContextMenuProps
> = (props) => {
  const drawerManager = useSoupEntityActionDrawer();
  const addTagAction = makeAddTagAction();

  const [tagPickerOpen, setTagPickerOpen] = createSignal(false);
  const [menuPosition, setMenuPosition] = createSignal<{
    x: number;
    y: number;
  }>();

  const menuEntities = () => {
    const selected = props.selectedEntities();
    if (
      selected.length > 1 &&
      selected.some((entity) => entity.id === props.entity.id)
    ) {
      return selected;
    }
    return [props.entity];
  };

  const canEditTags = () => addTagAction.canExecute(props.entity);

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
          <ContextMenu.Trigger
            as={props.as}
            class={cn('h-full w-full group/cm-trigger', props.class)}
            on:contextmenu={(event: MouseEvent) =>
              setMenuPosition({ x: event.clientX, y: event.clientY })
            }
          >
            {props.children}
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <Show when={props.entity}>
              <ContextMenuContent class="w-64 text-xs text-ink-muted">
                <SoupEntityActionsMenu
                  entities={menuEntities()}
                  list={props.list}
                  viewContext={props.viewContext}
                  onEditTags={
                    canEditTags()
                      ? () => setTimeout(() => setTagPickerOpen(true), 0)
                      : undefined
                  }
                />
                <Show when={props.extraItems}>
                  <MenuSeparator />
                  {props.extraItems}
                </Show>
              </ContextMenuContent>
            </Show>
          </ContextMenu.Portal>
        </ContextMenu>
        <Show when={tagPickerOpen() && tagEntityType(props.entity)}>
          {(entityType) => (
            <RowTagPicker
              entityId={props.entity.id}
              entityType={entityType()}
              properties={() => {
                const entity = props.entity;
                return 'properties' in entity ? entity.properties : undefined;
              }}
              position={menuPosition()}
              onClose={() => setTagPickerOpen(false)}
            />
          )}
        </Show>
      </Match>
    </Switch>
  );
};
