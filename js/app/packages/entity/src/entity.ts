// Core components
import { Root } from './core/Root';
import { Layout } from './core/Layout';
import { Slot } from './core/Slot';

import { EntityIcon } from './extractors/entity-icon';
import { EntityTitle } from './extractors/entity-title';
import { EntityTimestamp } from './extractors/entity-timestamp';
import { EntityEmailParticipants } from './extractors/entity-email-participants';
import { EntityOwner } from './extractors/entity-owner';

// Search components
import { ContentHits } from './extractors-search';

// Notification components
import {
  NotificationStacks,
  MobileNotificationStacks,
  NotificationIcon,
  NotificationSender,
  NotificationContent,
  NotificationTimestamp,
  NotificationDescription,
  NotificationCount,
} from './extractors-notification';

// Property components
import { EntityKeyProperties } from './extractors-property';

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
