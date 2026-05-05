import type { CallRecord } from '@service-storage/generated/schemas/callRecord';

/** Matches `@container` / grid breakpoint in `CallBlockAdapter`. */
export const CALL_RECORDING_STACKED_BREAKPOINT_PX = 860;

export function isCallRecordingStackedLayout(clientWidth: number): boolean {
  return clientWidth < CALL_RECORDING_STACKED_BREAKPOINT_PX;
}

export type CallRecordingParticipantRow = {
  userId: string;
  joinedAt: string;
  role: 'organizer' | 'participant';
};

/**
 * Historic call records can list the same user more than once; keep earliest join
 * and label organizer from `createdBy`.
 */
export function dedupeCallRecordingParticipants(
  participants: CallRecord['participants'],
  createdBy: string
): CallRecordingParticipantRow[] {
  const unique = new Map<string, CallRecordingParticipantRow>();
  for (const participant of participants) {
    const prev = unique.get(participant.userId);
    if (!prev || participant.joinedAt < prev.joinedAt) {
      unique.set(participant.userId, {
        userId: participant.userId,
        joinedAt: participant.joinedAt,
        role: participant.userId === createdBy ? 'organizer' : 'participant',
      });
    }
  }
  return Array.from(unique.values()).sort((a, b) =>
    a.joinedAt.localeCompare(b.joinedAt)
  );
}

export function seekDedupeKey(seconds: number): string {
  return `${Math.round(seconds * 1000)}`;
}

export function shouldCoalesceSeekGenerationBump(
  key: string,
  nowMs: number,
  lastKey: string | null,
  lastAtMs: number,
  minIntervalMs = 45
): boolean {
  return key === lastKey && nowMs - lastAtMs < minIntervalMs;
}

/** Transcript / participants meta strip toggles when the panel is open (stacked or wide). */
export const CALL_META_STRIP_TOGGLE_ACTIVE =
  'inline-flex items-center justify-center font-medium focus-visible:outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 bg-ink text-page not-disabled:hover:bg-ink/90 not-disabled:active:bg-ink/80 py-1 text-xs gap-1 rounded-xs [&_svg]:size-4 px-1 border border-transparent';

export const CALL_META_STRIP_TOGGLE_IDLE =
  'flex shrink-0 items-center gap-1.5 rounded-xs border border-edge-muted/50 px-2 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-hover/30 hover:text-ink focus-visible:outline-none';
