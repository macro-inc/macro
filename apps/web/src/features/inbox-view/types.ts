export type InboxTab = 'signal' | 'noise' | 'all' | 'reminders';

export type InboxGroupBy = 'date' | 'type' | 'none';

export type InboxTypeFilter =
  | 'documents'
  | 'tasks'
  | 'email'
  | 'channels'
  | 'agents'
  | 'projects'
  | 'github'
  | 'reminders'
  | 'calendar';

export type InboxReadFilter = 'unread' | 'read';
