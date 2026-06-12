import { useMaybeBlockId } from '@core/block';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { Property } from '@property';
import { Modals } from '@property/component/modal';
import {
  PropertiesProvider,
  type PropertySaveHandler,
  usePropertiesContext,
} from '@property/context/PropertiesContext';
import type { PropertyApiValues, Property as PropertyT } from '@property/types';
import { getEntityValues, hasValue } from '@property/utils';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn, Layer } from '@ui';
import {
  type Accessor,
  createMemo,
  For,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  type EntityData,
  type EntityWithProperties,
  isTaskEntity,
} from '../types/entity';
import {
  getSortedKeyProperties,
  soupPropertyToProperty,
} from './property-helpers';

function getEntityType(entity: EntityData): EntityType {
  return match(entity)
    .when(isTaskEntity, () => EntityType.TASK)
    .with({ type: 'channel' }, () => EntityType.CHANNEL)
    .with({ type: 'chat' }, () => EntityType.CHAT)
    .with({ type: 'project' }, () => EntityType.PROJECT)
    .with({ type: 'email' }, () => EntityType.THREAD)
    .with({ type: 'document' }, () => EntityType.DOCUMENT)
    .with({ type: 'channel_message' }, () => EntityType.CHANNEL)
    .with({ type: 'call' }, () => EntityType.CHANNEL)
    .with({ type: 'crm_company' }, () => EntityType.COMPANY)
    .with({ type: 'crm_contact' }, () => {
      // No CONTACT in the properties-service EntityType yet.
      throw new Error('crm contacts do not support properties');
    })
    .with({ type: 'automation' }, () => {
      throw new Error('automation entities do not support properties');
    })
    .with({ type: 'foreign' }, () => {
      throw new Error('foreign entities do not support properties');
    })
    .exhaustive();
}

interface EntityKeyPropertiesProps {
  /** Entity with properties attached */
  entity: EntityWithProperties<EntityData>;
  /** Callback when properties are refreshed */
  onRefresh?: () => void;
  /** Max visible user avatars in the assignees stack before collapsing to +N. */
  maxUserStackUsers?: number;
  /** Whether to show the edit affordance caret. */
  showCaret?: boolean;
}

/**
 * Displays key properties (Status, Priority, Assignees) for an entity as a
 * row of condensed icon-only pills. Each pill owns its own Kobalte-backed
 * popover editor via <Property.PopoverEditor /> rendered inline below the
 * trigger — no modal stack involved.
 */
export function EntityKeyProperties(props: EntityKeyPropertiesProps) {
  const entityType = createMemo(() => getEntityType(props.entity));

  const keyProperties = createMemo((): PropertyT[] => {
    const soupProperties = props.entity.properties ?? [];
    return getSortedKeyProperties(soupProperties.map(soupPropertyToProperty));
  });

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const saveOne = (property: PropertyT, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [
        {
          entityId: props.entity.id,
          entityType: entityType(),
          property,
          apiValues,
        },
      ],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  return (
    <Show when={keyProperties().length > 0}>
      <PropertiesProvider
        entityType={entityType()}
        canEdit={true}
        properties={keyProperties}
        onRefresh={props.onRefresh ?? (() => {})}
        onPropertyAdded={() => {}}
        onPropertyDeleted={() => {}}
        saveHandler={saveHandler}
      >
        <KeyPropertiesRow
          properties={keyProperties}
          onRefresh={props.onRefresh}
          maxUserStackUsers={props.maxUserStackUsers}
          showCaret={props.showCaret}
        />
        <ScopedPortal scope="split">
          <Suspense>
            <Modals />
          </Suspense>
        </ScopedPortal>
      </PropertiesProvider>
    </Show>
  );
}

function KeyPropertiesRow(props: {
  properties: Accessor<PropertyT[]>;
  onRefresh?: () => void;
  maxUserStackUsers?: number;
  showCaret?: boolean;
}) {
  const ctx = usePropertiesContext();
  const blockId = useMaybeBlockId();

  return (
    <div class="flex items-center gap-1 justify-start text-xs">
      <For each={props.properties()}>
        {(property) => {
          const isEmpty = () => !hasValue(property);

          const isUserEntity = () =>
            property.valueType === 'ENTITY' &&
            property.specificEntityType === 'USER';

          const isMultiUserEntity = () =>
            isUserEntity() && getEntityValues(property).length > 1;

          return (
            <Property.Root
              property={property}
              canEdit={ctx.canEdit}
              onSave={ctx.saveHandler.saveProperty}
              onRefresh={ctx.onRefresh}
            >
              <Property.Tooltip property={property}>
                <Layer depth={2}>
                  <Property.EditTrigger
                    class={cn(
                      'flex items-center gap-1 min-w-0 ring ring-edge-muted/50 ring-inset',
                      'px-1.5 py-1 leading-tight text-left rounded-full',
                      '@max-2xl/u-list:ring-0 @max-2xl/u-list:gap-0 @max-2xl/u-list:px-1 @max-2xl/u-list:justify-center',
                      {
                        'hover:bg-hover': ctx.canEdit,
                        'text-ink-extra-muted/50': isEmpty(),
                      }
                    )}
                  >
                    <div class="h-4" />
                    <Switch
                      fallback={
                        <Property.Icon
                          property={property}
                          class="size-3 shrink-0 @max-2xl/u-list:size-4"
                        />
                      }
                    >
                      <Match when={isMultiUserEntity()}>
                        <Property.UserStack
                          property={property}
                          maxUsers={props.maxUserStackUsers ?? 2}
                          avatarClass="@max-2xl/u-list:size-5"
                        />
                      </Match>
                      <Match when={isUserEntity()}>
                        <Property.Icon
                          property={property}
                          class="@max-2xl/u-list:size-5"
                        />
                      </Match>
                    </Switch>
                    <Property.Text
                      property={property}
                      class="@max-2xl/u-list:hidden"
                      fallback={
                        <>
                          <Property.Empty
                            label="None"
                            class="@max-2xl/u-list:hidden"
                          />
                          <Property.Empty class="hidden @max-2xl/u-list:inline-flex" />
                        </>
                      }
                    />
                    <Show when={props.showCaret ?? true}>
                      <Property.Caret class="@max-2xl/u-list:hidden" />
                    </Show>
                  </Property.EditTrigger>
                </Layer>
              </Property.Tooltip>
              <Property.PopoverEditor
                entitySelfFilter={{ entityType: ctx.entityType, blockId }}
              />
            </Property.Root>
          );
        }}
      </For>
    </div>
  );
}
