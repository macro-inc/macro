export type BrainEmailScope = Readonly<{
  viewer: string;
  team: string;
  agent: string;
}>;

export type BrainEmailThreadSummary = Readonly<{
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
}>;

export type BrainEmailMessage = Readonly<{
  id: string;
  author: string;
  address: string;
  sentAt: string;
  text: string;
}>;

export type BrainEmailThread = Readonly<{
  from: string;
  to: string;
  messages: readonly BrainEmailMessage[];
}>;

export type BrainEmailInbox =
  | Readonly<{ status: 'unavailable' | 'in-progress' }>
  | Readonly<{
      status: 'provisioned';
      address: string;
      source: 'bound' | 'fixture';
      threads: readonly BrainEmailThreadSummary[];
    }>;

export interface BrainEmailReader {
  readInbox(
    scope: BrainEmailScope,
    signal: AbortSignal
  ): Promise<BrainEmailInbox>;
  readThread(
    scope: BrainEmailScope,
    id: string,
    signal: AbortSignal
  ): Promise<BrainEmailThread | undefined>;
}

export function filterBrainEmailThreads(
  threads: readonly BrainEmailThreadSummary[],
  query: string
): readonly BrainEmailThreadSummary[] {
  const search = query.trim().toLowerCase();
  if (!search) return threads;

  return threads.filter(
    (thread) =>
      thread.sender.toLowerCase().includes(search) ||
      thread.subject.toLowerCase().includes(search)
  );
}

export function selectBrainEmailThread(
  visible: readonly BrainEmailThreadSummary[],
  selectedId: string | undefined
): BrainEmailThreadSummary | undefined {
  return visible.find((thread) => thread.id === selectedId) ?? visible[0];
}
