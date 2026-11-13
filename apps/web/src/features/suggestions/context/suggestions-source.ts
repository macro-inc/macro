import type { Accessor, Component } from 'solid-js';
import type { Generation } from '../core/generation';
import type { Suggestion, SuggestionTarget } from '../core/suggestion';

/** The person's suggestions and the two writes they can make. */
export type SuggestionsSource = {
  /** Open suggestions, best first, then those done lately; undefined until loaded. */
  suggestions: Accessor<Suggestion[] | undefined>;
  /** Nothing to show because loading failed. */
  failed: Accessor<boolean>;
  retry(): void;
  /** Read the feed again, after something outside it changed an suggestion. */
  refresh(): Promise<void>;
  /**
   * Take an suggestion up as the card showed it; a background prompt suggestion starts
   * running. `changed` means it was rewritten since: nothing was taken up and
   * the feed now holds the suggestion as it is.
   */
  accept(
    suggestion: Pick<Suggestion, 'id' | 'updatedAt'>
  ): Promise<'accepted' | 'changed'>;
  /** Turn an suggestion down. `leaving` sends it so it survives the page closing. */
  dismiss(id: string, options?: { leaving?: boolean }): Promise<void>;
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
 * The parts of a card that show an item of the app: its icon and name, a
 * draft's text. They read the app's own data, so the host supplies them.
 */
export type SuggestionItemParts = {
  /** An item's icon and name, as a chip that opens it. */
  Source: Component<{ target: SuggestionTarget; onOpen(): void }>;
  /** The text of a drafted reply. */
  Draft: Component<{ draft: SuggestionTarget; fallback: string }>;
  /**
   * How long the other side of a thread has waited for the person, as text
   * after `lead`; `fallback` when nobody waits or it isn't known.
   */
  Waiting: Component<{
    thread: SuggestionTarget;
    lead?: string;
    fallback?: string;
  }>;
};
