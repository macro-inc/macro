import type { Accessor, Component } from 'solid-js';
import type { Generation } from '../core/generation';
import type {
  Suggestion,
  SuggestionFeed,
  SuggestionTarget,
} from '../core/suggestion';

/** The person's feed and the writes they can make on it. */
export type SuggestionsSource = {
  /** The feed in the server's order, with its counts; undefined until loaded. */
  feed: Accessor<SuggestionFeed | undefined>;
  /** Nothing to show because loading failed. */
  failed: Accessor<boolean>;
  retry(): void;
  /** Read the feed again, after something outside it changed a suggestion. */
  refresh(): Promise<void>;
  /**
   * Take a suggestion up as the card showed it; a background prompt suggestion
   * starts running. `changed` means it was rewritten since: nothing was taken
   * up and the feed now holds the suggestion as it is.
   */
  accept(
    suggestion: Pick<Suggestion, 'id' | 'updatedAt'>
  ): Promise<'accepted' | 'changed'>;
  /** Turn a suggestion down; a run under way is stopped. */
  dismiss(id: string): Promise<void>;
  /** Take a dismissal back; the server allows it for a few minutes. */
  restore(id: string): Promise<void>;
  /**
   * The person looked at the feed and is leaving it: what is proposed from
   * now on is new next time.
   */
  viewed(): void;
};

/** Whether suggestions are being looked for, and asking for a fresh run. */
export type GenerationSource = {
  /** Undefined until read, or where the server can't say. */
  generation: Accessor<Generation | undefined>;
  /**
   * Ask for a fresh run. Afterwards `generation` says what happened: it is
   * running, or it must wait until `regenerateAvailableAt`.
   */
  regenerate(): Promise<void>;
};

/** A routine suggestion's drafted routine, as its card words it. */
export type RoutineCardText = {
  title: string;
  /** The routine's sentence, with the values AI picked marked. */
  sentence: { text: string; picked: boolean }[];
  /** When it runs, e.g. "Fridays at 9:00 AM". */
  when: string;
};

/** What the app does when a card's action is pressed. */
export type SuggestionActions = {
  /** Open the agent composer with the prompt typed in, unsent. */
  openComposer(prompt: string): Promise<void>;
  /** Open an item, or the part of it the suggestion is about. */
  openItem(target: SuggestionTarget): void;
  /** Open a reply draft a session wrote. */
  openDraft(draft: SuggestionTarget): void;
  /** A routine suggestion's wording; undefined while it loads or once it is gone. */
  routineText(routineSuggestionId: string): RoutineCardText | undefined;
  /** Open a routine suggestion's drafted routine for review before saving it. */
  reviewRoutine(routineSuggestionId: string): void;
  /** Save a routine suggestion's drafted routine as a routine, switched on. */
  turnOnRoutine(routineSuggestionId: string): Promise<void>;
};

/**
 * The part of a card that reads the app's items, supplied by the host: this
 * feature knows a source only by its id.
 */
export type SuggestionItemParts = {
  /**
   * A source's icon and name as a quiet link; `from` is who wrote, for a
   * thread. Shows nothing for an item the viewer can't read.
   */
  Source: Component<{
    target: SuggestionTarget;
    from?: string;
    onOpen(): void;
  }>;
};
