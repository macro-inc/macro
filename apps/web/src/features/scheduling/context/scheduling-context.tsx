import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type {
  Booking,
  BookingAttendance,
  SchedulingMember,
  SchedulingProfile,
  SchedulingScope,
} from '../core/types';

export type SchedulingSource = {
  profile: Accessor<SchedulingProfile | undefined>;
  bookings: Accessor<Booking[]>;
  loading: Accessor<boolean>;
  error: Accessor<string | undefined>;
  saving: Accessor<boolean>;
  save: (profile: SchedulingProfile) => Promise<void>;
  approve: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  loadInsights: (from: string, to: string) => Promise<Booking[]>;
  setAttendance: (id: string, attendance: BookingAttendance) => Promise<void>;
  reload: () => void;
};
export type SchedulingCapabilities = {
  scopes: Accessor<SchedulingScope[]>;
  members: Accessor<SchedulingMember[]>;
  userId: Accessor<string>;
  createSource: (scope: Accessor<SchedulingScope>) => SchedulingSource;
  copyLink: (profile: SchedulingProfile, slug?: string) => Promise<void>;
  link: (profile: SchedulingProfile, slug?: string) => string;
  openConnections: () => void;
  openTeamSettings: () => void;
  manageBooking: (id: string) => Promise<void>;
};
const Context = createContext<SchedulingCapabilities>();
export function SchedulingProvider(
  props: ParentProps<{ value: SchedulingCapabilities }>
) {
  return (
    <Context.Provider value={props.value}>{props.children}</Context.Provider>
  );
}
export function useScheduling() {
  const value = useContext(Context);
  if (!value) throw new Error('SchedulingProvider is required');
  return value;
}
