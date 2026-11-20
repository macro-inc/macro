import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal } from 'solid-js';
import type { EventReplacementSource } from '../context/event-replacement-source';
import type {
  EventReplacementPreview,
  EventReplacementRequest,
} from '../core/event-replacement';

export function createEventReplacement(source: EventReplacementSource) {
  const [open, setOpen] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [preview, setPreview] = createSignal<EventReplacementPreview>();
  const [confirmationAttempted, setConfirmationAttempted] = createSignal(false);
  let request: EventReplacementRequest | undefined;

  /** A confirmed operation is only ever checked or continued, never prepared again. */
  const resumes = () => {
    const current = preview();
    return (
      current !== undefined &&
      (confirmationAttempted() || current.status !== 'needs_confirmation')
    );
  };

  /**
   * Prepares the latest request. One that a newer request or a close
   * superseded while it was out is discarded, and the latest is prepared in
   * its place, so the preview always carries the edits as they are now.
   */
  async function prepare() {
    if (pending()) return;
    setPending(true);
    setError(undefined);
    try {
      for (;;) {
        const sent = request;
        if (!sent || !open()) return;
        const next = await source.prepare(sent);
        if (
          (sent !== request || !open()) &&
          next.status === 'needs_confirmation'
        ) {
          await source.discard(next.operationId);
          continue;
        }
        setPreview(next);
        setConfirmationAttempted(next.status !== 'needs_confirmation');
        return;
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not prepare the replacement.'
      );
    } finally {
      setPending(false);
    }
  }
  /**
   * Opens the replacement of `next`'s event with its unsaved edits. A preview
   * nobody confirmed is prepared again, so it shows the edits as they are now.
   */
  async function start(next: EventReplacementRequest) {
    setOpen(true);
    // A confirmation Outlook refused leaves the operation unconfirmed again;
    // only the provider's answer says whether it is still to be resumed.
    if (confirmationAttempted() && preview()?.status === 'needs_confirmation')
      await check();
    if (resumes()) return;
    request = next;
    setPreview(undefined);
    await prepare();
  }
  async function confirm() {
    const current = preview();
    if (!current || pending() || current.status === 'complete') return;
    setPending(true);
    setError(undefined);
    setConfirmationAttempted(true);
    try {
      setPreview(await source.confirm(current.operationId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not confirm progress. Check the saved operation before continuing.'
      );
    } finally {
      setPending(false);
    }
  }
  async function check() {
    const current = preview();
    if (!current || pending()) return;
    setPending(true);
    setError(undefined);
    try {
      const next = await source.status(current.operationId);
      setPreview(next);
      setConfirmationAttempted(next.status !== 'needs_confirmation');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not check progress.'
      );
    } finally {
      setPending(false);
    }
  }
  /** Closing returns to the editor; a preview nobody confirmed is discarded. */
  function close() {
    setOpen(false);
    setError(undefined);
    const current = preview();
    if (!current || resumes()) return;
    setPreview(undefined);
    fireAndForget(source.discard(current.operationId), 'calendar-replacement');
  }
  return {
    open,
    close,
    pending,
    error,
    preview,
    confirmationAttempted,
    start,
    prepare,
    confirm,
    check,
  };
}
