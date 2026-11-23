import { t } from '@app/lib/i18n';
import type { PermissionAction } from '@service-agent-harness/generated/schemas';
import { match } from 'ts-pattern';

/**
 * How a sentence names what a program may do to an entity (a registry
 * group), with the words the request card accents in `<em>`: a verb for
 * each action ("read", "edit"), the entity as people say it ("messages in
 * channels", "contacts in your CRM"), and whole phrases for the pairs a
 * verb and the entity would misname ("search your workspace").
 */

/** The verb for an action; `null` is an operation the registry left out. */
export function actionVerb(action: PermissionAction | null): string {
  return match(action)
    .with('read', () => t('agentPermissionsChat.verbRead'))
    .with('create', () => t('agentPermissionsChat.verbCreate'))
    .with('update', () => t('agentPermissionsChat.verbUpdate'))
    .with('send', () => t('agentPermissionsChat.verbSend'))
    .with('destroy', () => t('agentPermissionsChat.verbDestroy'))
    .with(null, () => t('agentPermissionsChat.verbUse'))
    .exhaustive();
}

/**
 * The entity a verb acts on, marked: `<em>messages</em> in <em>channels</em>`.
 * Undefined for a group this build doesn't know (the registry ships with
 * the server, so a new group can arrive first).
 */
export function entityPhrase(group: string): string | undefined {
  return match(group)
    .with('documents', () => t('agentPermissionsChat.entityDocuments'))
    .with('tasks', () => t('agentPermissionsChat.entityTasks'))
    .with('email', () => t('agentPermissionsChat.entityEmail'))
    .with('calendar', () => t('agentPermissionsChat.entityCalendar'))
    .with('channels', () => t('agentPermissionsChat.entityChannels'))
    .with('channel_admin', () => t('agentPermissionsChat.entityChannelAdmin'))
    .with('calls', () => t('agentPermissionsChat.entityCalls'))
    .with('external_chats', () => t('agentPermissionsChat.entityExternalChats'))
    .with('contacts', () => t('agentPermissionsChat.entityContacts'))
    .with('databases', () => t('agentPermissionsChat.entityDatabases'))
    .with('routines', () => t('agentPermissionsChat.entityRoutines'))
    .with('ai', () => t('agentPermissionsChat.entityAi'))
    .with('agents', () => t('agentPermissionsChat.entityAgents'))
    .with('connections', () => t('agentPermissionsChat.entityConnections'))
    .with('sharing', () => t('agentPermissionsChat.entitySharing'))
    .with('search', () => t('agentPermissionsChat.entitySearch'))
    .with('notifications', () => t('agentPermissionsChat.entityNotifications'))
    .with('passwords', () => t('agentPermissionsChat.entityPasswords'))
    .with('account', () => t('agentPermissionsChat.entityAccount'))
    .otherwise(() => undefined);
}

/**
 * A whole phrase for a pair the verb and the entity would misname (channel
 * administration's Send is creating, joining and changing channels), or
 * undefined to say the pair as its verb and entity.
 */
export function pairPhrase(
  group: string,
  action: PermissionAction | null
): string | undefined {
  return match([group, action] as const)
    .with(['channel_admin', 'send'], () =>
      t('agentPermissionsChat.thingChannelAdminSend')
    )
    .with(['channel_admin', 'destroy'], () =>
      t('agentPermissionsChat.thingChannelAdminDestroy')
    )
    .with(['calls', 'send'], () => t('agentPermissionsChat.thingCallsSend'))
    .with(['email', 'create'], () => t('agentPermissionsChat.thingEmailCreate'))
    .with(['channels', 'create'], () =>
      t('agentPermissionsChat.thingChannelsCreate')
    )
    .with(['external_chats', 'send'], () =>
      t('agentPermissionsChat.thingExternalChatsSend')
    )
    .with(['documents', 'send'], () =>
      t('agentPermissionsChat.thingDocumentsSend')
    )
    .with(['calendar', 'send'], () =>
      t('agentPermissionsChat.thingCalendarSend')
    )
    .with(['sharing', 'read'], () => t('agentPermissionsChat.thingSharingRead'))
    .with(['sharing', 'update'], () =>
      t('agentPermissionsChat.thingSharingUpdate')
    )
    .with(['sharing', 'send'], () => t('agentPermissionsChat.thingSharingSend'))
    .with(['search', 'read'], () => t('agentPermissionsChat.thingSearchRead'))
    .with(['search', 'create'], () =>
      t('agentPermissionsChat.thingSearchCreate')
    )
    .with(['search', 'update'], () =>
      t('agentPermissionsChat.thingSearchUpdate')
    )
    .with(['search', 'send'], () => t('agentPermissionsChat.thingSearchSend'))
    .with(['account', 'create'], () =>
      t('agentPermissionsChat.thingAccountCreate')
    )
    .with(['account', 'send'], () => t('agentPermissionsChat.thingAccountSend'))
    .with(['account', 'destroy'], () =>
      t('agentPermissionsChat.thingAccountDestroy')
    )
    .with(['connections', 'send'], () =>
      t('agentPermissionsChat.thingConnectionsSend')
    )
    .with(['ai', 'send'], () => t('agentPermissionsChat.thingAiSend'))
    .with(['routines', 'send'], () =>
      t('agentPermissionsChat.thingRoutinesSend')
    )
    .otherwise(() => undefined);
}
