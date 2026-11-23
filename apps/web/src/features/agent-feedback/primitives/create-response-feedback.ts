/**
 * Rating one agent response: what a click on a thumb means, which id each
 * action carries, and the note that follows a rating.
 *
 * A click on the current rating retracts it; a click on the other rating
 * switches and drops the note, which was about the other rating. Writes run one at a time, so a note saved while
 * its rating is still in flight lands after it.
 */
import { deepEqual } from '@core/util/compareUtils';
import { createSignal } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import type {
  FeedbackFailure,
  FeedbackNoteDraft,
  FeedbackWrite,
  ResponseFeedbackController,
  ResponseFeedbackSource,
} from '../context/response-feedback-context';
import { type FeedbackRating, normalizeNote } from '../core/subject';

export function createResponseFeedback(
  source: ResponseFeedbackSource,
  onFailure: (failure: FeedbackFailure) => void
): ResponseFeedbackController {
  const [inFlight, setInFlight] = createSignal(0);
  const [noteDraft, setNoteDraft] = createSignal<FeedbackNoteDraft>();
  // The last action the server didn't confirm. The request may still have
  // landed, so doing the same thing again reuses its id and the server
  // applies it at most once.
  let unconfirmed: { write: FeedbackWrite; id: string } | undefined;
  let queue: Promise<void> | undefined;

  async function send(write: FeedbackWrite) {
    const id =
      unconfirmed && deepEqual(unconfirmed.write, write)
        ? unconfirmed.id
        : uuidv7();
    const result = await source.write(id, write);
    if (result.isErr()) {
      unconfirmed = { write, id };
      onFailure(result.error);
      return;
    }
    unconfirmed = undefined;
  }

  async function sendAfter(
    previous: Promise<void> | undefined,
    write: FeedbackWrite
  ) {
    try {
      if (previous) await previous;
      await send(write);
    } finally {
      setInFlight((count) => count - 1);
    }
  }

  // Starts at once when idle, so the rating shows with the click; otherwise
  // after the writes before it.
  function enqueue(write: FeedbackWrite): Promise<void> {
    const previous = inFlight() > 0 ? queue : undefined;
    setInFlight((count) => count + 1);
    queue = sendAfter(previous, write);
    return queue;
  }

  async function rate(rating: FeedbackRating) {
    if (inFlight() > 0 || !source.ready()) return;
    const current = source.current();

    if (current?.rating === rating) {
      setNoteDraft(undefined);
      return enqueue({ kind: 'retract' });
    }

    // The note dialog opens with the click; skipping it leaves the rating.
    // A note said why the other rating was given, so a new rating starts
    // without one; only re-saving the same rating keeps it.
    setNoteDraft({ rating, note: '' });
    return enqueue({ kind: 'rate', rating, note: null });
  }

  function openNote() {
    const current = source.current();
    if (!current) return;
    setNoteDraft({ rating: current.rating, note: current.note ?? '' });
  }

  async function saveNote(note: string) {
    const draft = noteDraft();
    if (!draft) return;
    setNoteDraft(undefined);
    return enqueue({
      kind: 'rate',
      rating: draft.rating,
      note: normalizeNote(note),
    });
  }

  return {
    ready: source.ready,
    rating: () => source.current()?.rating,
    note: () => source.current()?.note ?? null,
    pending: () => inFlight() > 0,
    rate,
    noteDraft,
    openNote,
    closeNote: () => setNoteDraft(undefined),
    saveNote,
  };
}
