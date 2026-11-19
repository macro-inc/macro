import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';

const inFlight = new Set<Map<string, string | null>>();

export function recordListClaim(actionId: string, claimed: string | null) {
  for (const claims of inFlight) claims.set(actionId, claimed);
}

/** Keep only notifications received during this request. */
export async function readScheduleList(
  read: () => Promise<ScheduledAction[]>
): Promise<ScheduledAction[]> {
  const claims = new Map<string, string | null>();
  inFlight.add(claims);
  try {
    const rows = await read();
    if (!claims.size) return rows;
    return rows.map((row) => {
      const claimed = row.id ? claims.get(row.id) : undefined;
      return claimed === undefined
        ? row
        : { ...row, claimed: claimed ?? undefined };
    });
  } finally {
    inFlight.delete(claims);
  }
}
