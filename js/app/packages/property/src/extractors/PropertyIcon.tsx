import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { UserIcon } from '@core/component/UserIcon';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { Property } from '../types';
import { getEntityValues, getSelectValues } from '../utils';

type Props = {
  property: Property;
  class?: string;
};

/**
 * Renders the icon associated with a property's value:
 * - SELECT_*: option icon for the first value (status/priority icons).
 * - ENTITY+USER: avatar for the first user.
 * - everything else: null (extractor stays uninvolved).
 *
 * Layout-free — caller controls sizing/spacing.
 */
export function PropertyIcon(props: Props): JSX.Element {
  if (
    props.property.valueType === 'SELECT_STRING' ||
    props.property.valueType === 'SELECT_NUMBER'
  ) {
    const optionId = () => getSelectValues(props.property)[0];
    return (
      <Show when={optionId()}>
        {(id) => <PropertyValueIcon optionId={id()} class={props.class} />}
      </Show>
    );
  }

  if (
    props.property.valueType === 'ENTITY' &&
    props.property.specificEntityType === 'USER'
  ) {
    const userId = () => getEntityValues(props.property)[0]?.entity_id;
    return (
      <Show when={userId()}>
        {(id) => (
          <UserIcon id={id()} size="sm" suppressClick class={cn(props.class)} />
        )}
      </Show>
    );
  }

  return null;
}
