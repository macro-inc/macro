import { usePropertiesContext } from '@core/component/Properties/context/PropertiesContext';
import { getEntityValues, hasValue } from '@core/component/Properties/utils';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import { Property } from '@property';
import type { Property as PropertyT } from '@property/types';
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
      onEdit={ctx.openPropertyEditor}
    >
      <Property.Tooltip property={props.property}>
        <Layer depth={2}>
          <Property.EditTrigger class="list-property-cell min-w-0 rounded-full hover:bg-surface/50 inline-flex items-center gap-1 px-2 py-1.5 leading-tight text-left hover:ring ring-edge ring-inset">
            <Show
              when={!isEmpty()}
              fallback={
                <>
                  <CircleDashedEmpty class="size-3 shrink-0 opacity-50" />
                  <span class="truncate flex-1 opacity-50 @max-[840px]/u-list:hidden">
                    None
                  </span>
                </>
              }
            >
              <Switch
                fallback={
                  <Property.Icon
                    property={props.property}
                    class="size-3 shrink-0"
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
                    />
                  </div>
                </Match>
                <Match when={isUserEntity()}>
                  <Property.Icon property={props.property} />
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
    </Property.Root>
  );
};
