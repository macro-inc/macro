import { EntityIcon } from '@core/component/EntityIcon';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Accessor } from 'solid-js';
import { ENTITY_NAMES } from './entities';

const ICONS: Partial<Record<EntityType, string>> = {
  CHANNEL: 'channel',
  DOCUMENT: 'md',
  PROJECT: 'project',
  TASK: 'task',
  THREAD: 'email',
  CHAT: 'chat',
  COMPANY: 'crm_company',
  CONTACT: 'contact',
  INITIATIVE: 'initiative',
};

/** The loaded name and icon of an item, without the app's previews. */
export function usePropertyEntityDisplay(
  id: Accessor<string>,
  type: Accessor<EntityType | undefined>
) {
  return {
    name: () => ENTITY_NAMES[id()] ?? 'Unknown',
    icon: () => {
      const entityType = type();
      return (
        <EntityIcon
          targetType={(entityType && ICONS[entityType]) || 'unknown'}
          size="xs"
        />
      );
    },
  };
}
