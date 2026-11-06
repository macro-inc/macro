import { type Accessor, createSignal } from 'solid-js';
import type { EventReplacementSource } from '../context/event-replacement-source';
import type {
  EventReplacementPreview,
  EventReplacementTarget,
} from '../core/event-replacement';

export function createEventReplacement(
  source: EventReplacementSource,
  target: Accessor<EventReplacementTarget>,
  hasConference = true
) {
  const [open, setOpen] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [preview, setPreview] = createSignal<EventReplacementPreview>();
  const [confirmationAttempted, setConfirmationAttempted] = createSignal(false);
  const [removeConference, setRemoveConference] = createSignal(hasConference);
  const [onlyOccurrence, setOnlyOccurrence] = createSignal(false);

  async function prepare() {
    if (pending()) return;
    setPending(true);
    setError(undefined);
    try {
      const current = target();
      const next = await source.prepare(
        {
          ...current,
          recurrenceId: onlyOccurrence() ? current.recurrenceId : undefined,
        },
        removeConference()
      );
      setPreview(next);
      setConfirmationAttempted(next.status !== 'needs_confirmation');
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
  async function changeOptions() {
    const current = preview();
    if (!current || pending() || confirmationAttempted()) return;
    setPending(true);
    setError(undefined);
    try {
      await source.discard(current.operationId);
      setPreview(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not discard the preview.'
      );
    } finally {
      setPending(false);
    }
  }
  return {
    open,
    setOpen,
    pending,
    error,
    preview,
    confirmationAttempted,
    removeConference,
    setRemoveConference,
    onlyOccurrence,
    setOnlyOccurrence,
    prepare,
    confirm,
    check,
    changeOptions,
  };
}
