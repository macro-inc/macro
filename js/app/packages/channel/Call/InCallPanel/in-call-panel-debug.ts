import type { RemoteParticipant } from 'livekit-client';
import type { InCallPanelMember } from './types';

const QUERY_KEY = 'in_call_debug_extra';
/** Upper bound so absurd query values do not freeze the tab in dev. */
const MAX_EXTRAS = 500;

/**
 * Dev-only: append N fake remotes to the in-call roster for layout testing.
 * Add e.g. `?in_call_debug_extra=8` to the page URL (integer 1–500, clamped). No-op in prod builds.
 */
export function readInCallPanelDebugExtraRemoteCount(): number {
  if (!import.meta.env.DEV) return 0;
  if (typeof window === 'undefined') return 0;
  const raw = new URLSearchParams(window.location.search).get(QUERY_KEY);
  if (raw == null || raw === '') return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(n, MAX_EXTRAS);
}

export function debugInCallExtraRemoteMembers(
  count: number
): InCallPanelMember[] {
  return Array.from({ length: count }, (_, i) => {
    const participant = {
      sid: `debug-mock-${i}`,
      identity: `debug-mock-participant-${i}`,
      isAgent: false,
    } as RemoteParticipant;
    return { kind: 'remote' as const, participant };
  });
}
