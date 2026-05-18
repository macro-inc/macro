import { usePropertiesContext } from '@core/component/Properties/context/PropertiesContext';
import { getEntityValues, hasValue } from '@core/component/Properties/utils';
import { Property } from '@property';
import type { Property as PropertyT } from '@property/types';
import { Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import { type Component, Match, Switch } from 'solid-js';

type InlinePropertyValueProps = {
  property: PropertyT;
};

/**
 * Inline property pill shown beneath a task title when the side panel is
 * closed. Built from @property primitives — same visual surface as before,
 * but routes through Property.Root / Tooltip / EditTrigger so any property
 * type renders correctly without bespoke per-type components.
 */
export const InlinePropertyValue: Component<InlinePropertyValueProps> = (
  props
) => {
  const ctx = usePropertiesContext();

  const isReadOnly = () => !ctx.canEdit || props.property.isMetadata;
  const isEmpty = () => !hasValue(props.property);

  const isUserEntity = () =>
    props.property.valueType === 'ENTITY' &&
    props.property.specificEntityType === 'USER';

  const isMultiUserEntity = () =>
    isUserEntity() && getEntityValues(props.property).length > 1;

  return (
    <Property.Root
      property={props.property}
      canEdit={ctx.canEdit}
      onEdit={ctx.openPropertyEditor}
    >
      <Property.Tooltip property={props.property}>
        <Layer depth={2}>
          <Property.EditTrigger
            class={cn(
              'inline-flex items-center gap-1.5 min-w-0 ring ring-edge-muted',
              'px-2 py-1 leading-tight text-left rounded-full',
              'bg-surface',
              {
                'hover:bg-hover': !isReadOnly(),
                'text-ink-extra-muted/50': isEmpty(),
              }
            )}
          >
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
              fallback={<Property.Empty label="None" />}
            />
            <Property.Caret />
          </Property.EditTrigger>
        </Layer>
      </Property.Tooltip>
    </Property.Root>
  );
};
