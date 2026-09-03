import { useMaybeBlockId } from '@core/block';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import { Property } from '@property';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import type { Property as PropertyType } from '@property/types';
import { getEntityValues, hasValue } from '@property/utils';
import { Layer } from '@ui';
import { Match, Show, Switch } from 'solid-js';

/**
 * Tasks-owned adaptation of the established Soup task property cell.
 * It remains local so this view does not depend on legacy Soup orchestration.
 */
export function ListPropertyValue(props: { property: PropertyType }) {
  const context = usePropertiesContext();
  const blockId = useMaybeBlockId();
  const isUserEntity = () =>
    props.property.valueType === 'ENTITY' &&
    props.property.specificEntityType === 'USER';
  const userCount = () => {
    if (!isUserEntity()) return 0;
    return getEntityValues(props.property).length;
  };
  const isEmpty = () => !hasValue(props.property);
  const isInlineType = () =>
    props.property.valueType === 'STRING' ||
    props.property.valueType === 'NUMBER' ||
    props.property.valueType === 'BOOLEAN' ||
    props.property.valueType === 'LINK';

  if (isInlineType()) {
    return (
      <Property.Root
        property={props.property}
        canEdit={context.canEdit}
        onSave={context.saveHandler.saveProperty}
        onRefresh={context.onRefresh}
      >
        <Property.Tooltip property={props.property}>
          <Layer depth={2}>
            <div
              role="presentation"
              class="list-property-cell w-full max-w-full min-w-0 overflow-hidden rounded-full text-left hover:bg-surface/50 @max-[840px]/u-list:hidden"
              onClick={(event) => event.stopPropagation()}
            >
              <Property.InlineEditor />
            </div>
          </Layer>
        </Property.Tooltip>
      </Property.Root>
    );
  }

  return (
    <Property.Root
      property={props.property}
      canEdit={context.canEdit}
      onSave={context.saveHandler.saveProperty}
      onRefresh={context.onRefresh}
    >
      <Property.Tooltip property={props.property}>
        <Layer depth={2}>
          <Property.EditTrigger class="list-property-cell inline-flex w-full max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-full px-2 py-1.5 text-left leading-tight hover:bg-surface/50 @max-[840px]/u-list:px-1">
            <Show
              when={!isEmpty()}
              fallback={
                <>
                  <CircleDashedEmpty class="size-3 shrink-0 opacity-50 @max-[840px]/u-list:size-4" />
                  <span class="min-w-0 flex-1 truncate opacity-50 @max-[840px]/u-list:hidden">
                    {props.property.displayName}
                  </span>
                </>
              }
            >
              <Switch
                fallback={
                  <Property.Icon
                    property={props.property}
                    class="size-3 shrink-0 @max-[840px]/u-list:size-4"
                  />
                }
              >
                <Match when={userCount() > 1}>
                  <div class="@max-[840px]/u-list:hidden">
                    <Property.UserStack
                      property={props.property}
                      maxUsers={2}
                    />
                  </div>
                  <div class="hidden @max-[840px]/u-list:flex">
                    <Property.UserStack
                      property={props.property}
                      maxUsers={1}
                      avatarClass="@max-[840px]/u-list:size-5"
                    />
                  </div>
                </Match>
                <Match when={isUserEntity()}>
                  <Property.Icon
                    property={props.property}
                    class="@max-[840px]/u-list:size-5"
                  />
                </Match>
              </Switch>
              <Property.Text
                property={props.property}
                class="min-w-0 max-w-full flex-1 @max-[840px]/u-list:hidden"
              />
            </Show>
            <Property.Caret class="@max-[840px]/u-list:hidden" />
          </Property.EditTrigger>
        </Layer>
      </Property.Tooltip>
      <Property.PopoverEditor
        entitySelfFilter={{ entityType: context.entityType, blockId }}
      />
    </Property.Root>
  );
}
