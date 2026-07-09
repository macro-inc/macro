import { ContextMenuContent } from '@core/component/ContextMenu';
import { touchHandler } from '@core/directive/touchHandler';
import { isMobile } from '@core/mobile/isMobile';
import { type EntityData, isTaskEntity } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import { TagPickerPopover, useSoupDocTags } from '@property/tags';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import {
  type Accessor,
  createSignal,
  type FlowComponent,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import { useRowTagsVisible } from './filters-bar/search/search-tags-flag';
import { useSoupEntityActionDrawer } from './soup-entity-action-drawer-context';
import { SoupEntityActionsMenu } from './soup-entity-actions-menu';
import { useSoupView } from './soup-view-context';

interface SoupEntityContextMenuProps {
  entity: EntityData;
  onOpenChange?: (open: boolean) => void;
}

function tagEntityType(entity: EntityData): EntityType | undefined {
  return match(entity)
    .when(isTaskEntity, () => EntityType.TASK)
    .with({ type: 'document' }, () => EntityType.DOCUMENT)
    .with({ type: 'email' }, () => EntityType.THREAD)
    .with({ type: 'project' }, () => EntityType.PROJECT)
    .with({ type: 'chat' }, () => EntityType.CHAT)
    .otherwise(() => undefined);
}

// Detached tag picker anchored at the position the context menu opened from.
// Mounted only while open, so picker state resets on every invocation.
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
  const { soup } = useSoupView();
  const drawerManager = useSoupEntityActionDrawer();
  const rowTagsVisible = useRowTagsVisible();

  const [tagPickerOpen, setTagPickerOpen] = createSignal(false);
  const [menuPosition, setMenuPosition] = createSignal<{
    x: number;
    y: number;
  }>();

  // If the right-clicked row is part of a multi-selection, act on the whole
  // selection; otherwise act on just that row.
  const menuEntities = () => {
    const selected = soup.selection.selected();
    if (selected.length > 1 && soup.selection.isSelected(props.entity.id)) {
      return selected;
    }
    return [props.entity];
  };

  const canEditTags = () =>
    rowTagsVisible() && tagEntityType(props.entity) !== undefined;

  return (
    <Switch>
      <Match when={isMobile()}>
        <div
          class="size-full"
          data-soup-entity
          ref={(el) => {
            touchHandler(el, () => ({
              onLongPress: () => drawerManager?.open(props.entity, soup),
            }));
          }}
        >
          {props.children}
        </div>
      </Match>
      <Match when={true}>
        <ContextMenu onOpenChange={props.onOpenChange}>
          <ContextMenu.Trigger
            class="size-full group/cm-trigger"
            // Kobalte's trigger consumes the onContextMenu prop without
            // calling it, so capture the pointer position natively.
            on:contextmenu={(event: MouseEvent) =>
              setMenuPosition({ x: event.clientX, y: event.clientY })
            }
          >
            {props.children}
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <Show when={props.entity}>
              <ContextMenuContent class="text-xs text-ink-muted">
                <SoupEntityActionsMenu
                  entities={menuEntities()}
                  soup={soup}
                  // Deferred so the menu finishes closing (and its focus
                  // handoff settles) before the picker popover mounts, else
                  // the popover dismisses itself on focus-outside.
                  onEditTags={
                    canEditTags()
                      ? () => setTimeout(() => setTagPickerOpen(true), 0)
                      : undefined
                  }
                />
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
