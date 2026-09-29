import { type ComponentProps, type JSX, Match, Switch } from 'solid-js';
import { Property } from '../property';
import { getEntityValues } from '../utils';

type PropertyValuePillProps = Pick<
  ComponentProps<typeof Property.Root>,
  'property' | 'canEdit' | 'onSave' | 'onRefresh'
> & {
  emptyLabel?: JSX.Element;
  class?: string;
  entitySelfFilter?: ComponentProps<
    typeof Property.PopoverEditor
  >['entitySelfFilter'];
};

/** Controlled property pill shared by task and project composers. */
export function PropertyValuePill(props: PropertyValuePillProps) {
  const isUserEntity = () =>
    props.property.valueType === 'ENTITY' &&
    props.property.specificEntityType === 'USER';
  const isMultiUserEntity = () =>
    isUserEntity() && getEntityValues(props.property).length > 1;

  return (
    <Property.Root
      property={props.property}
      canEdit={props.canEdit}
      onSave={props.onSave}
      onRefresh={props.onRefresh}
    >
      <Property.Tooltip property={props.property}>
        <Property.Pill class={props.class} variant="outline">
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
      </Property.Tooltip>
      <Property.PopoverEditor entitySelfFilter={props.entitySelfFilter} />
    </Property.Root>
  );
}
