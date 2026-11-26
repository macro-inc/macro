import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableCalendarAddSharedEvent,
  enableCalendarGuestInvites,
  enableCalendarInvitationForward,
  enableCalendarSearchUi,
  enableCalendarTeamOoo,
  enableCalendarTeamSharing,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the calendar search UI (Search-view calendar type/rows and the
 * in-calendar keyword search) is enabled.
 */
export function useCalendarSearchUiFlag(): Accessor<boolean> {
  const searchFlag = useFeatureFlag(enableCalendarSearchUi);
  return () => searchFlag().enabled;
}

/**
 * Whether the team out-of-office surfaces (the side panel section and the
 * teammate absence overlay on the grid) are enabled.
 */
export function useCalendarTeamOooFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCalendarTeamOoo);
  return () => flag().enabled;
}

/** Whether a guest the organizer allows to invite may add guests. */
export function useCalendarGuestInvitesFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCalendarGuestInvites);
  return () => flag().enabled;
}

/** Whether a guest who cannot add guests may forward the invitation instead. */
export function useCalendarInvitationForwardFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCalendarInvitationForward);
  return () => flag().enabled;
}

/** Whether a channel member may add a shared event to their own calendar. */
export function useCalendarAddSharedEventFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCalendarAddSharedEvent);
  return () => flag().enabled;
}

export function useCalendarTeamSharingFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCalendarTeamSharing);
  return () => flag().enabled;
}
