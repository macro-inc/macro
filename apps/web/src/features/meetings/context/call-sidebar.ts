import type { Accessor } from 'solid-js';
import type { UpcomingCalendarEvent } from '../core/upcoming-calendar-events';

export type ActiveQuickCall = {
  id: string;
  /** The live call behind the meeting, once someone has joined. */
  callId?: string;
  createdBy: string;
  title: string;
  url: string;
};

export type CallSidebarSources = {
  upcoming: {
    events: Accessor<UpcomingCalendarEvent[]>;
    loading: Accessor<boolean>;
    error: Accessor<string | undefined>;
    refresh: () => void;
  };
  active: {
    calls: Accessor<ActiveQuickCall[]>;
    error: Accessor<string | undefined>;
    refresh: () => void;
  };
};

export type CallSidebarActions = {
  openEvent: (event: UpcomingCalendarEvent, anchor: HTMLElement) => void;
  join: (url: string) => void;
};
