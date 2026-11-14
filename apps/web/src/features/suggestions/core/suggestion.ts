/** An item a suggestion is about or produced, or a part of one such as a message. */
export type SuggestionTarget = {
  entityType: string;
  entityId: string;
  partId?: string;
};

/** A background run: the hidden agent session doing the work. */
export type SuggestionRun = {
  sessionId: string;
  startedAt: string;
};

export type SuggestionCategory =
  | 'important'
  | 'revisit'
  | 'save_money'
  | 'make_money';

export type EntityAction = 'reply' | 'review' | 'follow_up';

/** How a routine suggestion's drafted routine reads on its card. */
export type RoutineText = {
  /** What it does, with the values AI picked marked. */
  sentence: { text: string; picked: boolean }[];
  /** When it runs, e.g. "Fridays at 9:00 AM". */
  when: string;
};

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
      /**
       * A reply draft a session wrote: the thread, with the draft as its
       * part, and the start of the draft's text.
       */
      draft?: SuggestionTarget & { preview?: string };
      /** A reply suggestion's: who wrote the message still unanswered. */
      from?: string;
      /** A reply suggestion's: when that message came. */
      waitingSince?: string;
    }
  | {
      kind: 'routine';
      routineSuggestionId: string;
      /** How its drafted routine reads; absent once the routine is gone. */
      routine?: RoutineText;
    };

/**
 * Where a suggestion's card is, as the server says:
 * - `open`: waiting for the person.
 * - `running`: its background run is under way.
 * - `failed`: its last background run failed; Run tries again.
 * - `done`: finished: nothing more to do here.
 */
export type SuggestionStatus = 'open' | 'running' | 'failed' | 'done';

/** One proactive suggestion for the person, as the feed shows it. */
export type Suggestion = SuggestionKind & {
  id: string;
  title: string;
  summary: string;
  /** 0 to 100. */
  importance: number;
  categories: SuggestionCategory[];
  status: SuggestionStatus;
  /** Proposed since the person last opened their feed. */
  isNew: boolean;
  createdAt: string;
  /** When its state last changed: for a done suggestion, when it finished. */
  stateChangedAt: string;
  /** When it was last written; accepting sends it back, so a card can't take up text it never showed. */
  updatedAt: string;
  about: SuggestionTarget[];
  /** What a finished suggestion left to open; absent until it settled. */
  result?: SuggestionTarget;
};

/** How many of the person's shown suggestions have each status. */
export type FeedCounts = Record<SuggestionStatus, number>;

/**
 * The person's feed as the server ordered it: what waits or runs, best
 * first, then what finished in the last day.
 */
export type SuggestionFeed = {
  suggestions: Suggestion[];
  counts: FeedCounts;
};

export type FeedFilter = 'all' | 'running' | 'open' | 'done';

export function matchesFilter(status: SuggestionStatus, filter: FeedFilter) {
  if (filter === 'all') return true;
  if (filter === 'running') return status === 'running' || status === 'failed';

  return status === filter;
}

/** The tabs' counts: a failed run sits with the running ones. */
export function tabCounts(counts: FeedCounts): Record<FeedFilter, number> {
  return {
    all: counts.open + counts.running + counts.failed + counts.done,
    running: counts.running + counts.failed,
    open: counts.open,
    done: counts.done,
  };
}

/** How long someone has waited, in whole hours or days; nothing under an hour. */
export function waitingFor(
  since: string,
  now: Date
): { unit: 'hours' | 'days'; count: number } | undefined {
  const hours = Math.floor((now.getTime() - Date.parse(since)) / 3_600_000);
  if (!(hours >= 1)) return undefined;
  if (hours < 24) return { unit: 'hours', count: hours };

  return { unit: 'days', count: Math.floor(hours / 24) };
}
