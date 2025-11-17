import { archiveEmail } from '@app/email/emailActions';
import { useGlobalNotificationSource } from '@app/notification/NotificationProvider';
import { markNotificationsForEntityAsDone } from '@app/notification/notificationUtils';
import type { EntityData } from '@macro-entity';
import { type Accessor, createSignal } from 'solid-js';
import { openBulkEditEntityModal } from './EntitySelectionToolbarModal';
import {
  createBulkifiedAction,
  createEntityActionRegistry,
  type EntityActionRegistry,
  type EntityActionResult,
} from './UnifiedEntityActions';

export function createUnifiedListViewActionRegistry(
  emailView: Accessor<'inbox' | 'sent' | 'drafts' | 'all'>
): EntityActionRegistry {
  const registry = createEntityActionRegistry();
  const notificationSource = useGlobalNotificationSource();

  async function markAsDone(entity: EntityData): Promise<EntityActionResult> {
    try {
      if (emailView() === 'inbox') {
        if (entity.type === 'email') {
          await archiveEmail(entity.id, {
            isDone: entity.done,
            optimisticallyExclude: true,
          });
        }
        return { success: true };
      }

      if (entity.type === 'email') {
        await archiveEmail(entity.id, { isDone: entity.done });
      }

      markNotificationsForEntityAsDone(notificationSource, entity);
      return { success: true };
    } catch (error) {
      console.error('Failed to mark entity as done:', error);
      return { success: false, message: 'Failed to mark as done' };
    }
  }

  registry.registerBulk(
    'mark_as_done',
    markAsDone,
    createBulkifiedAction(markAsDone)
  );

  return registry;
}
