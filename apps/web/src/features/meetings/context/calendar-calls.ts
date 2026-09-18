import type { Accessor } from 'solid-js';
import type {
  CalendarCallEvent,
  CalendarCallItem,
} from '../core/calendar-calls';

export type CalendarCallsSource = {
  items: Accessor<CalendarCallItem[]>;
  loading: Accessor<boolean>;
  error: Accessor<string | undefined>;
  refreshing: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  loadMore: () => void;
  refresh: () => void;
};

export type CalendarCallsActions = {
  schedule: () => void;
  join: (item: CalendarCallItem) => Promise<void>;
  copy: (url: string) => Promise<boolean>;
  resolveLink?: (item: CalendarCallItem) => Promise<string | undefined>;
  openRecord: (id: string) => void;
  openEvent?: (event: CalendarCallEvent) => void;
  editEvent?: (event: CalendarCallEvent) => void;
  rename: (id: string, title: string) => Promise<void>;
  revoke: (id: string) => Promise<void>;
};
