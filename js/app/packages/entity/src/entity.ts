// Core components

import { Layout } from './core/Layout';
import { Root } from './core/Root';
import { Slot } from './core/Slot';
import { EntityEmailParticipants } from './extractors/entity-email-participants';
import { EntityIcon } from './extractors/entity-icon';
import { EntityOwner } from './extractors/entity-owner';
import { EntityTimestamp } from './extractors/entity-timestamp';
import { EntityTitle } from './extractors/entity-title';
// Notification components
import {
  MobileNotificationStacks,
  NotificationContent,
  NotificationCount,
  NotificationDescription,
  NotificationIcon,
  NotificationSender,
  NotificationStackRow,
  NotificationStacks,
  NotificationTimestamp,
} from './extractors-notification';
// Property components
import { EntityKeyProperties } from './extractors-property';
// Search components
import { ContentHits } from './extractors-search';

/**
 * Entity composable component namespace.
 */
export const Entity = {
  Root,
  Layout,
  Slot,
  Icon: EntityIcon,
  Title: EntityTitle,
  Timestamp: EntityTimestamp,
  EmailParticipants: EntityEmailParticipants,
  Owner: EntityOwner,
  Search: {
    ContentHits: ContentHits,
  },
  Notification: {
    StackRow: NotificationStackRow,
    Stacks: NotificationStacks,
    MobileStacks: MobileNotificationStacks,
    Icon: NotificationIcon,
    Sender: NotificationSender,
    Content: NotificationContent,
    Timestamp: NotificationTimestamp,
    Description: NotificationDescription,
    Count: NotificationCount,
  },
  Properties: EntityKeyProperties,
};
