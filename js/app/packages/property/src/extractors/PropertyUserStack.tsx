import { UserIcon } from '@core/component/UserIcon';
import { AvatarGroup } from '@ui';
import { For, Show } from 'solid-js';
import type { Property } from '../types';
import { getEntityValues, isEntityProperty } from '../utils';

type Props = {
  property: Property;
  maxUsers?: number;
};

/**
 * Avatar stack for ENTITY+USER properties. Renders nothing for other types.
 */
export function PropertyUserStack(props: Props) {
  const isUser = () =>
    isEntityProperty(props.property) &&
    props.property.specificEntityType === 'USER';

  const max = () => props.maxUsers ?? 3;

  const entities = () => getEntityValues(props.property);
  const display = () => entities().slice(0, max());
  const remaining = () => Math.max(0, entities().length - max());

  return (
    <Show when={isUser()}>
      <AvatarGroup size="sm">
        <For each={display()}>
          {(entity) => (
            <UserIcon
              id={entity.entity_id}
              size="sm"
              suppressClick
              showTooltip={false}
            />
          )}
        </For>
        <Show when={remaining() > 0}>
          <AvatarGroup.Count size="sm">+{remaining()}</AvatarGroup.Count>
        </Show>
      </AvatarGroup>
    </Show>
  );
}
