/**
 * The feature's contracts: what rating one response needs from storage
 * (`ResponseFeedbackSource`), and the controller a feedback scope hands to the
 * controls rendered inside it.
 */
import type { Result } from 'neverthrow';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { FeedbackRating, FeedbackState } from '../core/subject';

/**
 * `unavailable`: the feature is off for this person on the server, or the
 * response can't be rated. `forbidden`: no view access to the container.
 */
export type FeedbackFailure = 'unavailable' | 'forbidden' | 'failed';

export type FeedbackWrite =
  | { kind: 'rate'; rating: FeedbackRating; note: string | null }
  | { kind: 'retract' };

/** One response's rating, for the person viewing it. */
export type ResponseFeedbackSource = {
  /** The current rating; undefined while unrated or not loaded. */
  current: Accessor<FeedbackState | undefined>;
  /** The container's ratings have loaded; nothing renders before. */
  ready: Accessor<boolean>;
  /**
   * Shows the write at once and rolls it back if the server refuses it.
   * `id` names the action: the server applies an id once, so a retry of the
   * same action passes the same id.
   */
  write(
    id: string,
    write: FeedbackWrite
  ): Promise<Result<void, FeedbackFailure>>;
};

/** The rating dialog's subject: the rating the note goes with. */
export type FeedbackNoteDraft = { rating: FeedbackRating; note: string };

/** What the controls inside a feedback scope read and call. */
export type ResponseFeedbackController = {
  ready: Accessor<boolean>;
  rating: Accessor<FeedbackRating | undefined>;
  note: Accessor<string | null>;
  /** A write is in flight; the controls wait for it. */
  pending: Accessor<boolean>;
  /** Rates, or retracts when `rating` is the current one. */
  rate(rating: FeedbackRating): Promise<void>;
  /** Open while the person can add or edit the note. */
  noteDraft: Accessor<FeedbackNoteDraft | undefined>;
  openNote(): void;
  closeNote(): void;
  saveNote(note: string): Promise<void>;
};

const ResponseFeedbackContext =
  createContext<Accessor<ResponseFeedbackController | undefined>>();

export const ResponseFeedbackProvider = ResponseFeedbackContext.Provider;

/**
 * The enclosing scope's controller. Undefined outside a scope, and inside one
 * whose response can't be rated (feature off, not an agent's response), so
 * the controls render nothing there.
 */
export function useResponseFeedback(): Accessor<
  ResponseFeedbackController | undefined
> {
  const controller = useContext(ResponseFeedbackContext);
  return () => controller?.();
}
