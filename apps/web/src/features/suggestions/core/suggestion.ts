/** An item an suggestion is about or produced, or a part of one such as a message. */
export type SuggestionTarget = {
  entityType: string;
  entityId: string;
  partId?: string;
};

/** How a background run is going, as its session says. */
export type RunProgress = 'running' | 'finished' | 'failed';

export type SuggestionRun = {
  /** The hidden agent session that holds the result. */
  sessionId: string;
  startedAt: string;
  progress: RunProgress;
};

export type SuggestionCategory =
  | 'important'
  | 'revisit'
  | 'save_money'
  | 'make_money';

export type EntityAction = 'reply' | 'review' | 'follow_up';

export type SuggestionKind =
  | { kind: 'prompt'; runMode: 'composer'; prompt: string }
  | {
      kind: 'prompt';
      runMode: 'background';
      prompt: string;
      /** What the run will post or send, and where; absent when nothing. */
      sends?: string;
      run?: SuggestionRun;
    }
  | {
      kind: 'entity';
      action: EntityAction;
      /** A reply draft a session wrote: the thread, with the draft as its part. */
      draft?: SuggestionTarget;
    }
  | { kind: 'routine'; routineSuggestionId: string };

/** One proactive suggestion for the person, as the feed shows it. */
export type Suggestion = SuggestionKind & {
  id: string;
  title: string;
  summary: string;
  /** 0 to 100. */
  importance: number;
  categories: SuggestionCategory[];
  /** Open suggestions are `proposed` or `accepted`; `done` ones finished lately. */
  state: 'proposed' | 'accepted' | 'done';
  createdAt: string;
  /** When its state last changed: for a done suggestion, when it finished. */
  stateChangedAt: string;
  /** When it was last written; accepting sends it back, so a card can't take up text it never showed. */
  updatedAt: string;
  about: SuggestionTarget[];
  produced: SuggestionTarget[];
};

/**
 * Where an suggestion's card is:
 * - `open`: waiting for the person.
 * - `running`: its background run is under way.
 * - `failed`: its last background run failed; Run tries again.
 * - `done`: finished: nothing more to do here.
 */
export type SuggestionStatus = 'open' | 'running' | 'failed' | 'done';

export function suggestionStatus(suggestion: Suggestion): SuggestionStatus {
  if (suggestion.state === 'done') return 'done';

  if (
    suggestion.kind === 'prompt' &&
    suggestion.runMode === 'background' &&
    suggestion.run
  ) {
    if (suggestion.run.progress === 'failed') return 'failed';
    // Finished, and about to be listed as done.
    if (suggestion.run.progress === 'finished') return 'done';

    return 'running';
  }

  return 'open';
}

/** What a finished suggestion's card opens: what it made, else its run's session. */
export function suggestionResult(
  suggestion: Suggestion
): SuggestionTarget | undefined {
  // A finished run lists its session first, then what the session made.
  const made = suggestion.produced.find(
    (target) => target.entityType !== 'agent_session'
  );
  if (made) return made;

  const [session] = suggestion.produced;
  if (session) return session;

  if (
    suggestion.kind === 'prompt' &&
    suggestion.runMode === 'background' &&
    suggestion.run
  ) {
    return { entityType: 'agent_session', entityId: suggestion.run.sessionId };
  }

  return undefined;
}

export type FeedFilter = 'all' | 'running' | 'open' | 'done';

export function matchesFilter(status: SuggestionStatus, filter: FeedFilter) {
  if (filter === 'all') return true;
  if (filter === 'running') return status === 'running' || status === 'failed';

  return status === filter;
}

/**
 * The feed in the order it shows: suggestions as the server ranked them, most
 * important first, then what is done.
 */
export function orderFeed(suggestions: Suggestion[]): Suggestion[] {
  const isDone = (suggestion: Suggestion) =>
    suggestionStatus(suggestion) === 'done';

  return [
    ...suggestions.filter((suggestion) => !isDone(suggestion)),
    ...suggestions.filter(isDone),
  ];
}

/** How many suggestions each filter holds, for the tabs. */
export function filterCounts(
  suggestions: Suggestion[]
): Record<FeedFilter, number> {
  const counts = { all: suggestions.length, running: 0, open: 0, done: 0 };

  for (const suggestion of suggestions) {
    const status = suggestionStatus(suggestion);
    if (status === 'failed' || status === 'running') counts.running += 1;
    else counts[status] += 1;
  }

  return counts;
}

/** Home's rows: the open and running suggestions that matter most. */
export function topPriorities(
  suggestions: Suggestion[],
  limit: number
): Suggestion[] {
  return orderFeed(suggestions)
    .filter((suggestion) => suggestionStatus(suggestion) !== 'done')
    .slice(0, limit);
}

/** Whether an suggestion arrived after the person last looked at the feed. */
export function isNewSince(
  suggestion: Suggestion,
  lastSeenAt: string | undefined
) {
  if (!lastSeenAt || suggestion.state !== 'proposed') return false;

  return Date.parse(suggestion.createdAt) > Date.parse(lastSeenAt);
}
