import type { Accessor } from 'solid-js';
import type { MeetingRouteTarget } from '../core/meeting-navigation';

export type MeetingNavigationCapabilities = {
  target: Accessor<MeetingRouteTarget>;
  replace: (
    target: Extract<MeetingRouteTarget, { shareToken: string }>
  ) => void;
  returnToApp: () => void;
};

/** Stable owner across the setup and connected URLs of a single meeting. */
export type MeetingRouteEntry =
  | { kind: 'new'; shareToken?: string }
  | { kind: 'existing'; shareToken: string }
  | { kind: 'unavailable' };
