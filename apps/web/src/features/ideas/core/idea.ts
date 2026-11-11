/** An item an idea is about or produced, or a part of one such as a message. */
export type IdeaTarget = {
  entityType: string;
  entityId: string;
  partId?: string;
};

/** How a background run is going, as its session says. */
export type RunProgress = 'running' | 'finished' | 'failed';

export type IdeaRun = {
  /** The hidden agent session that holds the result. */
  sessionId: string;
  startedAt: string;
  progress: RunProgress;
};

export type IdeaCategory =
  | 'important'
  | 'revisit'
  | 'save_money'
  | 'make_money';

export type EntityAction = 'reply' | 'review' | 'follow_up';

export type IdeaKind =
  | { kind: 'prompt'; runMode: 'composer'; prompt: string }
  | {
      kind: 'prompt';
      runMode: 'background';
      prompt: string;
      /** What the run will post or send, and where; absent when nothing. */
      sends?: string;
      run?: IdeaRun;
    }
  | {
      kind: 'entity';
      action: EntityAction;
      /** A reply draft a session wrote: the thread, with the draft as its part. */
      draft?: IdeaTarget;
    }
  | { kind: 'routine'; routineSuggestionId: string };

/** One proactive suggestion for the person, as the feed shows it. */
export type Idea = IdeaKind & {
  id: string;
  title: string;
  summary: string;
  /** 0 to 100. */
  importance: number;
  categories: IdeaCategory[];
  /** Open ideas are `proposed` or `accepted`; `done` ones finished lately. */
  state: 'proposed' | 'accepted' | 'done';
  createdAt: string;
  /** When its state last changed: for a done idea, when it finished. */
  stateChangedAt: string;
  /** When it was last written; accepting sends it back, so a card can't take up text it never showed. */
  updatedAt: string;
  about: IdeaTarget[];
  produced: IdeaTarget[];
};

/**
 * Where an idea's card is:
 * - `open`: waiting for the person.
 * - `running`: its background run is under way.
 * - `failed`: its last background run failed; Run tries again.
 * - `done`: finished: nothing more to do here.
 */
export type IdeaStatus = 'open' | 'running' | 'failed' | 'done';

export function ideaStatus(idea: Idea): IdeaStatus {
  if (idea.state === 'done') return 'done';

  if (idea.kind === 'prompt' && idea.runMode === 'background' && idea.run) {
    if (idea.run.progress === 'failed') return 'failed';
    // Finished, and about to be listed as done.
    if (idea.run.progress === 'finished') return 'done';

    return 'running';
  }

  return 'open';
}

/** What a finished idea's card opens: what it made, else its run's session. */
export function ideaResult(idea: Idea): IdeaTarget | undefined {
  // A finished run lists its session first, then what the session made.
  const made = idea.produced.find(
    (target) => target.entityType !== 'agent_session'
  );
  if (made) return made;

  const [session] = idea.produced;
  if (session) return session;

  if (idea.kind === 'prompt' && idea.runMode === 'background' && idea.run) {
    return { entityType: 'agent_session', entityId: idea.run.sessionId };
  }

  return undefined;
}

export type FeedFilter = 'all' | 'running' | 'open' | 'done';

export function matchesFilter(status: IdeaStatus, filter: FeedFilter) {
  if (filter === 'all') return true;
  if (filter === 'running') return status === 'running' || status === 'failed';

  return status === filter;
}

/**
 * The feed in the order it shows: ideas as the server ranked them, most
 * important first, then what is done.
 */
export function orderFeed(ideas: Idea[]): Idea[] {
  const isDone = (idea: Idea) => ideaStatus(idea) === 'done';

  return [...ideas.filter((idea) => !isDone(idea)), ...ideas.filter(isDone)];
}

/** How many ideas each filter holds, for the tabs. */
export function filterCounts(ideas: Idea[]): Record<FeedFilter, number> {
  const counts = { all: ideas.length, running: 0, open: 0, done: 0 };

  for (const idea of ideas) {
    const status = ideaStatus(idea);
    if (status === 'failed' || status === 'running') counts.running += 1;
    else counts[status] += 1;
  }

  return counts;
}

/** Home's rows: the open and running ideas that matter most. */
export function topPriorities(ideas: Idea[], limit: number): Idea[] {
  return orderFeed(ideas)
    .filter((idea) => ideaStatus(idea) !== 'done')
    .slice(0, limit);
}

/** Whether an idea arrived after the person last looked at the feed. */
export function isNewSince(idea: Idea, lastSeenAt: string | undefined) {
  if (!lastSeenAt || idea.state !== 'proposed') return false;

  return Date.parse(idea.createdAt) > Date.parse(lastSeenAt);
}
