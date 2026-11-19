import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';

type Claims = Map<string, string | null>;

const inFlight = new Set<Claims>();

/** A run's start or stop, kept for the routine reads still in flight. */
export function recordClaim(actionId: string, claimed: string | null) {
  for (const claims of inFlight) claims.set(actionId, claimed);
}

/** Keep only notifications received during this request. */
async function readWithClaims<T>(
  read: () => Promise<T>,
  apply: (claims: Claims, value: T) => T
): Promise<T> {
  const claims: Claims = new Map();
  inFlight.add(claims);
  try {
    const value = await read();
    return claims.size ? apply(claims, value) : value;
  } finally {
    inFlight.delete(claims);
  }
}

function applyClaim(claims: Claims, row: ScheduledAction): ScheduledAction {
  const claimed = row.id ? claims.get(row.id) : undefined;
  return claimed === undefined
    ? row
    : { ...row, claimed: claimed ?? undefined };
}

export function readScheduleList(read: () => Promise<ScheduledAction[]>) {
  return readWithClaims(read, (claims, rows) =>
    rows.map((row) => applyClaim(claims, row))
  );
}

/** One routine, as `readScheduleList` reads a list. */
export function readSchedule(read: () => Promise<ScheduledAction>) {
  return readWithClaims(read, applyClaim);
}
