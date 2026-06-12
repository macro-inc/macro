import { useMaybeBlockId } from '@core/block';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import { Property } from '@property';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import type { Property as PropertyT } from '@property/types';
import { getEntityValues, hasValue } from '@property/utils';
import { type Component, Match, Show, Switch } from 'solid-js';
import './list-property-value.css';
import { Layer } from '@ui';

type ListPropertyValueProps = {
  property: PropertyT;
};

/**
 * Property pill for list views. Built from @property primitives,
 * with `@max-[840px]/u-list:hidden` collapsing the label and caret on narrow
 * containers so cells reduce to icon-only.
 */
export const ListPropertyValue: Component<ListPropertyValueProps> = (props) => {
  const ctx = usePropertiesContext();
  const blockId = useMaybeBlockId();

  const isUserEntity = () =>
    props.property.valueType === 'ENTITY' &&
    props.property.specificEntityType === 'USER';

  const userCount = () =>
    isUserEntity() ? getEntityValues(props.property).length : 0;

  const isEmpty = () => !hasValue(props.property);

  return (
    <Property.Root
      property={props.property}
      canEdit={ctx.canEdit}
      onSave={ctx.saveHandler.saveProperty}
      onRefresh={ctx.onRefresh}
    >
      <Property.Tooltip property={props.property}>
        <Layer depth={2}>
          <Property.EditTrigger class="list-property-cell min-w-0 rounded-full hover:bg-surface/50 inline-flex items-center gap-1 px-2 py-1.5 leading-tight text-left hover:ring ring-edge ring-inset @max-[840px]/u-list:hover:ring-0 @max-[840px]/u-list:px-1">
            <Show
              when={!isEmpty()}
              fallback={
                <>
                  <CircleDashedEmpty class="size-3 shrink-0 opacity-50 @max-[840px]/u-list:size-4" />
                  <span class="truncate flex-1 opacity-50 @max-[840px]/u-list:hidden">
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
                  {/* Wide: 2 avatars; narrow: collapse to 1 to fit the cell. */}
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
                class="flex-1 @max-[840px]/u-list:hidden"
              />
            </Show>
            <Property.Caret class="@max-[840px]/u-list:hidden" />
          </Property.EditTrigger>
        </Layer>
      </Property.Tooltip>
      <Property.PopoverEditor
        entitySelfFilter={{ entityType: ctx.entityType, blockId }}
      />
    </Property.Root>
  );
};
