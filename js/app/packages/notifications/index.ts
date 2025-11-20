// Core types
export type {
  UnifiedNotification,
  CompositeEntity,
} from './types';
export { compositeEntity, notificationEntity } from './types';

// Notification helpers
export {
  useNotificationsForEntity,
  notificationIsOfEntity,
  notificationIsOfEntityType,
  notificationIsRead,
  entityHasUnreadNotifications,
  useUnreadNotifications,
  useEntityHasUnreadNotifications,
  useEntityTypeNotifications,
  useUnreadEntityTypeNotifications,
  markNotificationsForEntityAsDone,
  markNotificationForEntityIdAsRead,
  markNotificationsForEntityAsRead,
  useNotificationsMutedForEntity,
  createEffectOnEntityTypeNotification,
} from './notification-helpers';

// Notification metadata
export type {
  NotificationMetadataByType,
  UnifiedNotificationMetadata,
  TypedNotification,
  UnifiedNotificationWithMetadata,
} from './notification-metadata';
export {
  isItemSharedUser,
  isItemSharedOrganization,
  isChannelMention,
  isDocumentMention,
  isChannelInvite,
  isChannelMessageSend,
  isChannelMessageReply,
  isChannelMessageDocument,
  isNewEmail,
  isInviteToTeam,
  isRejectTeamInvite,
  extractMetadata,
  isNotificationWithMetadata,
  notificationWithMetadata,
} from './notification-metadata';

// Notification source
export type { NotificationSource } from './notification-source';
export { createNotificationSource } from './notification-source';

// Notification navigation
export type { NavigationActions } from './notification-navigation';
export { navigateToNotification } from './notification-navigation';

// Notification preview
export type { NotificationData } from './notification-preview';
export {
  NOTIFICATION_LABEL_BY_TYPE,
  extractNotificationData,
  toBrowserNotification,
} from './notification-preview';

// Notification resolvers
export type {
  UserNameResolver,
  DocumentNameResolver,
  NotificationBlockNameResolver,
} from './notification-resolvers';
export {
  DefaultUserNameResolver,
  DefaultDocumentNameResolver,
  DefaultNotificationBlockNameResolver,
} from './notification-resolvers';

// Notification election
export { createTabLeaderSignal } from './notification-election';

// Components
export type {
  PlatformNotificationInterface,
  CreateAppNotificationInterface,
  AppNotification,
  NotificationUnsupported,
} from './components/PlatformNotificationProvider';
export {
  PlatformNotificationProvider,
  usePlatformNotificationState,
} from './components/PlatformNotificationProvider';

export {
  DebouncedNotificationReadMarker,
  EmailDebouncedReadMarker,
  DocumentDebouncedNotificationReadMarker,
  ChannelDebouncedNotificationReadMarker,
} from './components/DebouncedNotificationReadMarker';

// Queries
export { fetchNotificationsForEntities } from './queries/entities-notifications-query';
export { createMutedEntitiesQuery } from './queries/muted-entities-query';
