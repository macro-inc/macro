import { match } from 'ts-pattern';
import { PropertyDefinition } from '../../entities/properties/property-definition';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type PropertyEvent = Extract<
  MacroEvent,
  {
    event_type:
      | `entity_property.${string}`
      | `entity_properties.${string}`
      | `property.${string}`
      | `property_option.${string}`;
  }
>;

/**
 * Attach the property definition (and acted-for user) handles to a property
 * event. For entity property events the item the value belongs to is
 * `metadata.entity_type` and `metadata.entity_id`.
 */
export function hydratePropertyEvent(
  client: MacroClient,
  event: PropertyEvent,
) {
  const onBehalfOf = (id: string | null | undefined) =>
    id ? User.byId(client, id) : undefined;

  return match(event)
    .with({ event_type: 'entity_property.updated' }, ({ metadata }) => ({
      event_type: 'entity_property.updated' as const,
      metadata,
      property: PropertyDefinition.byId(
        client,
        metadata.property_definition_id,
      ),
      onBehalfOf: onBehalfOf(metadata.on_behalf_of),
    }))
    .with({ event_type: 'entity_properties.cleared' }, ({ metadata }) => ({
      event_type: 'entity_properties.cleared' as const,
      metadata,
      onBehalfOf: onBehalfOf(metadata.on_behalf_of),
    }))
    .with(
      { event_type: 'property.created' },
      { event_type: 'property.deleted' },
      { event_type: 'property_option.created' },
      { event_type: 'property_option.updated' },
      { event_type: 'property_option.deleted' },
      ({ event_type, metadata }) => ({
        event_type,
        metadata,
        property: PropertyDefinition.byId(
          client,
          metadata.property_definition_id,
        ),
      }),
    )
    .exhaustive((unknown) => {
      console.warn('macro sdk: unknown property event', unknown);
      return undefined;
    });
}
