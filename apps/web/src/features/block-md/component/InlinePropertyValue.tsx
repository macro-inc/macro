import { useMaybeBlockId } from '@core/block';
import { Property } from '@property';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import type { Property as PropertyT } from '@property/types';
import { getEntityValues } from '@property/utils';
import { Layer } from '@ui';
import { type Component, type JSX, Match, Switch } from 'solid-js';

type InlinePropertyValueProps = {
  property: PropertyT;
  /** Label rendered when the property is empty. Defaults to "None". */
  emptyLabel?: JSX.Element;
};

/**
 * Inline property pill shown beneath a task title when the side panel is
 * closed. Built from @property primitives — same visual surface as before,
 * but routes through Property.Root / Tooltip / Pill so any property
 * type renders correctly without bespoke per-type components.
 */
export const InlinePropertyValue: Component<InlinePropertyValueProps> = (
  props
) => {
  const ctx = usePropertiesContext();
  const blockId = useMaybeBlockId();

  const isUserEntity = () =>
    props.property.valueType === 'ENTITY' &&
    props.property.specificEntityType === 'USER';

  const isMultiUserEntity = () =>
    isUserEntity() && getEntityValues(props.property).length > 1;

  return (
    <Property.Root
      property={props.property}
      canEdit={ctx.canEdit}
      onSave={ctx.saveHandler.saveProperty}
      onRefresh={ctx.onRefresh}
    >
      <Property.Tooltip property={props.property}>
        <Layer depth={2}>
          <Property.Pill>
            <Switch
              fallback={
                <Property.Icon
                  property={props.property}
                  class="size-3 shrink-0"
                />
              }
            >
              <Match when={isMultiUserEntity()}>
                <Property.UserStack property={props.property} maxUsers={2} />
              </Match>
              <Match when={isUserEntity()}>
                <Property.Icon property={props.property} />
              </Match>
            </Switch>
            <Property.Text
              property={props.property}
              fallback={
                <Property.Empty
                  label={props.emptyLabel ?? props.property.displayName}
                />
              }
            />
            <Property.Caret />
          </Property.Pill>
        </Layer>
      </Property.Tooltip>
      <Property.PopoverEditor
        entitySelfFilter={{ entityType: ctx.entityType, blockId }}
      />
    </Property.Root>
  );
};
