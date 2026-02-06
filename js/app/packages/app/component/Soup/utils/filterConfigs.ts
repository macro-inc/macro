import type { ExpandedEntityType } from '@macro-entity';
import type { DocumentTypeFilter, FilterOptions } from '../../ViewConfig';
import { ENABLE_TASKS_TABS } from '@core/constant/featureFlags';

/**
 * Discriminated union for entity type filter configurations.
 * Each kind determines which fields are valid, making illegal states unrepresentable.
 */
export type EntityTypeFilterConfig =
  | {
      kind: 'entityType';
      type: ExpandedEntityType;
      label: string;
      iconType: string;
      enabled: boolean;
      shortcut: string;
    }
  | {
      kind: 'channelCategory';
      channelCategory: 'people' | 'groups';
      label: string;
      iconType: string;
      enabled: boolean;
      shortcut: string;
    }
  | {
      kind: 'documentPreset';
      type: 'document';
      documentTypes: DocumentTypeFilter[];
      label: string;
      iconType: string;
      enabled: boolean;
      shortcut: string;
    };

/**
 * Entity type filter button configurations for the topbar.
 * Only one filter can be active at a time (exclusive selection).
 */
export const ENTITY_TYPE_FILTERS: EntityTypeFilterConfig[] = [
  {
    kind: 'documentPreset',
    type: 'document',
    documentTypes: ['md', 'canvas'],
    label: 'Docs',
    iconType: 'md',
    enabled: true,
    shortcut: 'd',
  },
  {
    kind: 'entityType',
    type: 'chat',
    label: 'Agents',
    iconType: 'chat',
    enabled: true,
    shortcut: 'a',
  },
  {
    kind: 'channelCategory',
    channelCategory: 'people',
    label: 'People',
    iconType: 'channel',
    enabled: true,
    shortcut: 'p',
  },
  {
    kind: 'channelCategory',
    channelCategory: 'groups',
    label: 'Teams',
    iconType: 'direct_message',
    enabled: true,
    shortcut: 'm',
  },
  {
    kind: 'entityType',
    type: 'task',
    label: 'Tasks',
    iconType: 'task',
    enabled: ENABLE_TASKS_TABS,
    shortcut: 't',
  },
  {
    kind: 'entityType',
    type: 'email',
    label: 'Mail',
    iconType: 'email',
    enabled: true,
    shortcut: 'l',
  },
  {
    kind: 'documentPreset',
    type: 'document',
    documentTypes: ['code', 'image', 'pdf', 'unknown'],
    label: 'Files',
    iconType: 'project',
    enabled: true,
    shortcut: 'f',
  },
];

/**
 * Focus filter coupling configuration.
 * Defines the coupled state that must be set together when toggling inbox/other filters.
 * This makes the coupling explicit and centralized rather than scattered across toggle functions.
 */
export const FOCUS_FILTER_CONFIGS = {
  signal: {
    focusFilters: ['signal'] as const,
    notificationFilter: 'notDone' as FilterOptions['notificationFilter'],
    unrollNotifications: true,
  },
  noise: {
    focusFilters: ['noise'] as const,
    notificationFilter: 'notDone' as FilterOptions['notificationFilter'],
    unrollNotifications: true,
  },
  none: {
    focusFilters: [] as ('signal' | 'noise')[],
    notificationFilter: 'all' as FilterOptions['notificationFilter'],
    unrollNotifications: false,
  },
} as const;

export type FocusFilterTarget = 'signal' | 'noise';
