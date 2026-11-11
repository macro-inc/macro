import { Property } from '@property';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import type { Property as PropertyType } from '@property/types';
import { getEntityValues, hasValue } from '@property/utils';
import { cn, Layer } from '@ui';
import { type Accessor, Match, Show, Switch } from 'solid-js';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import { PropertyEmptyIcon } from '../extractors/PropertyEmpty';
import { formatDate } from '../utils/formatting';

/** Shared property cell for unified task and native project lists. */
export function ListPropertyValue(props: {
  property: PropertyType;
  entityId: string;
  class?: string;
}) {
  const context = usePropertiesContext();
  const isInlineType = () =>
    props.property.valueType === 'STRING' ||
    props.property.valueType === 'NUMBER' ||
    props.property.valueType === 'BOOLEAN' ||
    props.property.valueType === 'LINK';

  if (isInlineType()) {
    return (
      <Property.Root
        class="min-w-0 max-w-full"
        property={props.property}
        canEdit={context.canEdit}
        onSave={context.saveHandler.saveProperty}
      >
        {(property) => (
          <Property.Tooltip property={property()}>
            <Layer depth={2}>
              <div
                role="presentation"
                class="list-property-cell w-full max-w-full min-w-0 overflow-hidden rounded-full text-left hover:bg-button-tertiary-hover hover:text-ink @max-[840px]/u-list:hidden"
                onClick={(event) => event.stopPropagation()}
              >
                <Property.InlineEditor />
              </div>
            </Layer>
          </Property.Tooltip>
        )}
      </Property.Root>
    );
  }

  return (
    <Property.Root
      class="min-w-0 max-w-full @max-[840px]/u-list:w-full"
      property={props.property}
      canEdit={context.canEdit}
      onSave={context.saveHandler.saveProperty}
    >
      {(property) => (
        <ListPropertyCell
          property={property}
          entityId={props.entityId}
          class={props.class}
        />
      )}
    </Property.Root>
  );
}

function ListPropertyCell(props: {
  property: Accessor<PropertyType>;
  entityId: string;
  class?: string;
}) {
  const context = usePropertiesContext();
  const isUserEntity = () =>
    props.property().valueType === 'ENTITY' &&
    props.property().specificEntityType === 'USER';
  const userCount = () => {
    if (!isUserEntity()) return 0;
    return getEntityValues(props.property()).length;
  };
  const isEmpty = () => !hasValue(props.property());
  const label = () => {
    const property = props.property();
    if (property.valueType === 'DATE' && property.value) {
      return `${property.displayName}: ${formatDate(property.value)}`;
    }
    return undefined;
  };

  return (
    <>
      <Property.Tooltip property={props.property()}>
        <Layer depth={2}>
          <Property.Pill
            aria-label={label()}
            class={cn(
              'list-property-cell inline-flex h-auto w-full max-w-full min-w-0 shrink items-center gap-1 overflow-hidden rounded-full border-0 px-2 py-1.5 text-left font-normal leading-tight touch:min-h-0 touch:min-w-0 @max-[840px]/u-list:p-1',
              isUserEntity() && '@max-[840px]/u-list:justify-start',
              props.class
            )}
          >
            <span class="sr-only">
              {props.property().displayName}
              {isEmpty() ? '' : ': '}
            </span>
            <Show
              when={!isEmpty()}
              fallback={
                <>
                  <Show
                    when={
                      props.property().valueType !== 'DATE' ||
                      props.property().propertyDefinitionId ===
                        SYSTEM_PROPERTY_IDS.DUE_DATE
                    }
                  >
                    <PropertyEmptyIcon
                      muted
                      propertyDefinitionId={
                        props.property().propertyDefinitionId
                      }
                      class={
                        props.property().propertyDefinitionId ===
                          SYSTEM_PROPERTY_IDS.PRIORITY ||
                        props.property().propertyDefinitionId ===
                          SYSTEM_PROPERTY_IDS.DUE_DATE
                          ? 'text-ink-extra-muted @max-[840px]/u-list:size-4'
                          : 'size-3.5 text-ink-extra-muted @max-[840px]/u-list:size-4'
                      }
                    />
                  </Show>
                  <span
                    aria-hidden="true"
                    class="min-w-0 flex-1 truncate opacity-50 @max-[840px]/u-list:hidden"
                  >
                    {props.property().displayName}
                  </span>
                </>
              }
            >
              <Switch
                fallback={
                  <Property.Icon
                    property={props.property()}
                    class="shrink-0 @max-[840px]/u-list:size-4"
                  />
                }
              >
                <Match when={userCount() > 1}>
                  <div class="@max-[840px]/u-list:hidden">
                    <Property.UserStack
                      property={props.property()}
                      maxUsers={2}
                    />
                  </div>
                  <div class="hidden @max-[840px]/u-list:flex">
                    <Property.UserStack
                      property={props.property()}
                      maxUsers={userCount() === 2 ? 2 : 1}
                      avatarClass="@max-[840px]/u-list:size-5"
                    />
                  </div>
                </Match>
                <Match when={isUserEntity()}>
                  <Property.Icon
                    property={props.property()}
                    class="@max-[840px]/u-list:size-5"
                  />
                </Match>
              </Switch>
              <Property.Text
                property={props.property()}
                hideIcon={props.property().specificEntityType === 'INITIATIVE'}
                resolveSingleEntity={
                  props.property().specificEntityType === 'INITIATIVE'
                }
                class="min-w-0 max-w-full flex-1 @max-[840px]/u-list:sr-only"
              />
            </Show>
            <Property.Caret class="@max-[840px]/u-list:hidden" />
          </Property.Pill>
        </Layer>
      </Property.Tooltip>
      <Property.PopoverEditor
        entitySelfFilter={{
          entityType: context.entityType,
          blockId: props.entityId,
        }}
      />
    </>
  );
}
