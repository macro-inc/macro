import { makeAddTagAction } from '@app/features/next-soup/actions';
import { ProjectPickerPopover } from '@app/features/projects/project-property';
import type { EntityData } from '@entity';
import {
  TagPickerPopover,
  tagEntityType,
  useSoupDocTags,
} from '@property/tags';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { type Accessor, type Component, createSignal, Show } from 'solid-js';

/** Viewport point a picker opens against. */
export type SoupEntityMenuAnchor = { x: number; y: number };

function EntityTagPicker(props: {
  entityId: string;
  entityType: EntityType;
  properties: Accessor<SoupProperty[] | undefined>;
  position: SoupEntityMenuAnchor | undefined;
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

export type SoupEntityMenuPickers = {
  /** Undefined when the entity can't be tagged, which drops the menu item. */
  openTagPicker: Accessor<(() => void) | undefined>;
  openProjectPicker: () => void;
  /** Mount outside the menu: the pickers outlive the menu that opened them. */
  Pickers: Component;
};

/**
 * The tag and project pickers an entity menu hands off to. Both open a tick
 * after their item runs so the menu's own dismissal cannot take back the
 * focus the popover claims on mount.
 */
export function createSoupEntityMenuPickers(options: {
  entity: Accessor<EntityData>;
  entities: Accessor<EntityData[]>;
  anchor: Accessor<SoupEntityMenuAnchor | undefined>;
}): SoupEntityMenuPickers {
  const addTagAction = makeAddTagAction();
  const [tagPickerOpen, setTagPickerOpen] = createSignal(false);
  const [projectTaskIds, setProjectTaskIds] = createSignal<string[]>();

  const Pickers: Component = () => (
    <>
      <Show when={projectTaskIds()}>
        {(ids) => (
          <ProjectPickerPopover
            taskIds={ids()}
            open
            onOpenChange={(open) => {
              if (!open) setProjectTaskIds(undefined);
            }}
            getAnchorRect={options.anchor}
          />
        )}
      </Show>
      <Show when={tagPickerOpen() && tagEntityType(options.entity())}>
        {(entityType) => (
          <EntityTagPicker
            entityId={options.entity().id}
            entityType={entityType()}
            properties={() => {
              const entity = options.entity();
              return 'properties' in entity ? entity.properties : undefined;
            }}
            position={options.anchor()}
            onClose={() => setTagPickerOpen(false)}
          />
        )}
      </Show>
    </>
  );

  return {
    openTagPicker: () =>
      addTagAction.canExecute(options.entity())
        ? () => setTimeout(() => setTagPickerOpen(true), 0)
        : undefined,
    openProjectPicker: () => {
      const ids = options.entities().map((entity) => entity.id);
      setTimeout(() => setProjectTaskIds(ids), 0);
    },
    Pickers,
  };
}
