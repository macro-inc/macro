import type { Accessor, Component } from 'solid-js';
import type { Idea, IdeaTarget } from '../core/idea';

/** The person's ideas and the two writes they can make. */
export type IdeasSource = {
  /** Open ideas, best first, then those done lately; undefined until loaded. */
  ideas: Accessor<Idea[] | undefined>;
  /** Nothing to show because loading failed. */
  failed: Accessor<boolean>;
  retry(): void;
  /** Read the feed again, after something outside it changed an idea. */
  refresh(): Promise<void>;
  /** Take an idea up; a background prompt idea starts running. */
  accept(id: string): Promise<void>;
  /** Turn an idea down. `leaving` sends it so it survives the page closing. */
  dismiss(id: string, options?: { leaving?: boolean }): Promise<void>;
};

/** A routine idea's suggestion, as its card words it. */
export type RoutineIdeaText = {
  title: string;
  /** The routine's sentence, with the values AI picked marked. */
  sentence: { text: string; picked: boolean }[];
  /** When it runs, e.g. "Fridays at 9:00 AM". */
  when: string;
};

/** What the app does when a card's action is pressed. */
export type IdeaActions = {
  /** Open the agent composer with the prompt typed in, unsent. */
  openComposer(prompt: string): Promise<void>;
  /** Open an item, or the part of it the idea is about. */
  openItem(target: IdeaTarget): void;
  /** Open a reply draft a session wrote. */
  openDraft(draft: IdeaTarget): void;
  /** A routine idea's wording; undefined while it loads or once it is gone. */
  routineText(suggestionId: string): RoutineIdeaText | undefined;
  /** Open a routine idea's suggestion for review before saving it. */
  reviewRoutine(suggestionId: string): void;
  /** Save a routine idea's suggestion as a routine, switched on. */
  turnOnRoutine(suggestionId: string): Promise<void>;
};

/**
 * The parts of a card that show an item of the app: its icon and name, a
 * draft's text. They read the app's own data, so the host supplies them.
 */
export type IdeaItemParts = {
  /** An item's icon and name, as a chip that opens it. */
  Source: Component<{ target: IdeaTarget; onOpen(): void }>;
  /** The text of a drafted reply. */
  Draft: Component<{ draft: IdeaTarget }>;
  /** What a finished idea made: its icon and name, over a line about it. */
  Result: Component<{ target: IdeaTarget; line: string }>;
};
