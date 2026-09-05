import { useMaybeBlockId } from '@core/block';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import { Property } from '@property';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import type { Property as PropertyT } from '@property/types';
import { getEntityValues, hasValue } from '@property/utils';
import { cn, Layer } from '@ui';
import { type Component, Match, Show, Switch } from 'solid-js';
import './list-property-value.css';

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

  // STRING / NUMBER / BOOLEAN / LINK edit in place rather than via the
  // EditTrigger + popover pair.
  const isInlineType = () =>
    props.property.valueType === 'STRING' ||
    props.property.valueType === 'NUMBER' ||
    props.property.valueType === 'BOOLEAN' ||
    props.property.valueType === 'LINK';

  if (isInlineType()) {
    return (
      <Property.Root
        property={props.property}
        canEdit={ctx.canEdit}
        onSave={ctx.saveHandler.saveProperty}
        onRefresh={ctx.onRefresh}
      >
        <Property.Tooltip property={props.property}>
          <Layer depth={2}>
            {/* Stop clicks from bubbling to the row (which opens the entity). */}
            <div
              class="list-property-cell w-full max-w-full min-w-0 overflow-hidden rounded-full hover:bg-surface/50 text-left @max-[840px]/u-list:hidden"
              onClick={(e) => e.stopPropagation()}
              role="presentation"
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
      canEdit={ctx.canEdit}
      onSave={ctx.saveHandler.saveProperty}
      onRefresh={ctx.onRefresh}
    >
      <Property.Tooltip property={props.property}>
        <Layer depth={2}>
          <Property.Pill
            class={cn(
              'list-property-cell w-full min-w-0 overflow-hidden',
              '@max-[840px]/u-list:justify-center',
              userCount() > 1
                ? '@max-[840px]/u-list:px-1'
                : '@max-[840px]/u-list:w-6 @max-[840px]/u-list:p-0'
            )}
          >
            <Show
              when={!isEmpty()}
              fallback={
                <>
                  <CircleDashedEmpty class="size-3 shrink-0 opacity-50" />
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
                      avatarClass="@max-[840px]/u-list:size-4"
                    />
                  </div>
                </Match>
                <Match when={isUserEntity()}>
                  <Property.Icon
                    property={props.property}
                    class="@max-[840px]/u-list:size-4"
                  />
                </Match>
              </Switch>
              <Property.Text
                property={props.property}
                class="min-w-0 max-w-full flex-1 @max-[840px]/u-list:hidden"
              />
            </Show>
            <Property.Caret class="@max-[840px]/u-list:hidden" />
          </Property.Pill>
        </Layer>
      </Property.Tooltip>
      <Property.PopoverEditor
        entitySelfFilter={{ entityType: ctx.entityType, blockId }}
      />
    </Property.Root>
  );
};
