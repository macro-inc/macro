export type BrainScope = Readonly<{
  viewer: string;
  team: string;
  agent: string;
}>;

export type WorkStatus = 'Working' | 'Out of Office' | 'Unavailable';

export type ActivityEntry = Readonly<{
  id: string;
  title: string;
  source: string;
  occurredAt: string;
  observedAt: string;
  outcome: 'Working' | 'Completed' | 'Queued';
  canOpen: boolean;
}>;

export type BrainObservation = ActivityEntry &
  Readonly<{ visibility: 'visible' | 'denied' }>;

export type BrainSnapshot = Readonly<{
  scope: BrainScope;
  name: string;
  role: string;
  portrait?: string;
  fleetSearch?: string;
  teamName: string;
  lifecycle: string;
  setupPending?: boolean;
  workStatus: WorkStatus;
  statusSince?: Readonly<{ label: string; at: string }>;
  journalDay?: string;
  activity: readonly ActivityEntry[];
}>;

export type BrainRead =
  | { status: 'ready'; snapshot: BrainSnapshot }
  | { status: 'unavailable' };

export type BrainReader = (scope: BrainScope) => Promise<BrainRead>;

export async function readScopedBrain(
  read: BrainReader,
  scope: BrainScope
): Promise<BrainRead> {
  try {
    const result = await read(scope);
    if (
      result.status === 'ready' &&
      result.snapshot.scope.viewer === scope.viewer &&
      result.snapshot.scope.team === scope.team &&
      result.snapshot.scope.agent === scope.agent
    ) {
      return result;
    }
  } catch {
    // The unavailable view is also the failure boundary for the source.
  }

  return { status: 'unavailable' };
}

export function visibleActivity(
  observations: readonly BrainObservation[]
): ActivityEntry[] {
  const latest = new Map<string, BrainObservation>();
  for (const entry of observations) {
    const previous = latest.get(entry.id);
    if (
      !previous ||
      entry.observedAt > previous.observedAt ||
      (entry.observedAt === previous.observedAt &&
        entry.visibility === 'denied')
    ) {
      latest.set(entry.id, entry);
    }
  }

  return [...latest.values()]
    .filter(({ visibility }) => visibility === 'visible')
    .map(({ visibility: _visibility, ...entry }) => entry)
    .sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id)
    );
}

export function dailyJournal(
  entries: readonly ActivityEntry[],
  day: string | undefined
) {
  const completed = entries.filter(
    (entry) =>
      entry.outcome === 'Completed' && entry.occurredAt.slice(0, 10) === day
  );
  const updatedAt = completed.reduce(
    (latest, entry) => (entry.observedAt > latest ? entry.observedAt : latest),
    ''
  );

  return { completed, updatedAt };
}
