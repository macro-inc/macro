import { t } from '@app/lib/i18n';
import type { TimestampedItem } from '@core/util/freshSort';

export type CreateProjectCommandItem = {
  id: 'new-project';
  kind: 'new-project';
  bucket: 'command';
  searchText: string;
  sortTimestamp: number;
  timestamps: TimestampedItem;
};

export const newProjectCommand: CreateProjectCommandItem = {
  id: 'new-project',
  kind: 'new-project',
  bucket: 'command',
  // Searched in the interface language, so read at match time.
  get searchText() {
    return t('create.createNewProject');
  },
  sortTimestamp: 0,
  timestamps: { viewedAt: undefined, updatedAt: undefined },
};
