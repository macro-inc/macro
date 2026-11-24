// Which loaded-read notification-time classes the database shows to be one
// tab's stamp running behind the other's (closure M2). chk-stamp.ts writes a
// verdict per read whose recorded differences include a notifiedAt that one
// side lacks; report.ts renames a class only when every read carrying it was
// checked and passed.

export type StampVerdict = { read: number; transport: string; grouped: string; rows: number; latest: number; pastCap: number; pastRetention: number };
export type StampRead = { id: number; classes?: string[] };

/**
 * A read passes when it was read over REST on both sides (so the PR changes
 * neither how its rows are read nor how they are stamped), grouped (grouped
 * pages carry no notified_at, so the time is the tab's own stamp), and every
 * checked row's one-side value is the viewer's latest notification before the
 * read, with the tab's stamp neither past the floor cap nor past its retention.
 */
export function stampVerified(v: StampVerdict | undefined): boolean {
  return !!v && v.transport === 'rest->rest' && v.grouped !== 'none' && v.rows > 0 && v.latest === v.rows && v.pastCap === 0 && v.pastRetention === 0;
}

/** The `field:<kind>.notifiedAt` classes whose every read passed. */
export function tabStampClasses(reads: StampRead[], verdicts: StampVerdict[]): string[] {
  const byRead = new Map(verdicts.map((v) => [v.read, v]));
  const readsOf = new Map<string, number[]>();
  for (const r of reads) for (const cls of r.classes ?? []) if (/^field:\w+\.notifiedAt$/.test(cls)) readsOf.set(cls, [...(readsOf.get(cls) ?? []), r.id]);
  return [...readsOf].filter(([, ids]) => ids.every((id) => stampVerified(byRead.get(id)))).map(([cls]) => cls);
}
