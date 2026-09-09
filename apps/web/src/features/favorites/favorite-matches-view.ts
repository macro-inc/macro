import type { Favorite } from '@service-storage/generated/schemas/favorite';
/** Match the entity family shown by each app view. */
export function favoriteMatchesView(favorite: Favorite, view: string): boolean {
  switch (view) {
    case 'mail':
      return favorite.entityType === 'email_thread';
    case 'channels':
      return (
        favorite.entityType === 'channel' ||
        favorite.entityType === 'channel_message'
      );
    case 'tasks':
      return (
        favorite.entityType === 'document' &&
        favorite.documentSubType === 'task'
      );
    case 'documents':
      return (
        favorite.entityType === 'document' &&
        favorite.documentSubType !== 'task'
      );
    case 'agents':
      return (
        favorite.entityType === 'chat' ||
        favorite.entityType === 'agent_session'
      );
    case 'folders':
      return favorite.entityType === 'project';
    case 'calendar':
      return favorite.entityType === 'calendar_event';
    case 'companies':
      return (
        favorite.entityType === 'crm_company' ||
        favorite.entityType === 'crm_contact'
      );
    case 'reminders':
      return favorite.entityType === 'reminder';
    case 'calls':
      return favorite.entityType === 'call';
    case 'inbox':
    case 'recent':
    case 'activity':
    case 'tag':
      return true;
    default:
      return false;
  }
}
