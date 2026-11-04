import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError, thrownResultErrorHasCode } from '@core/util/result';
import { INVALID_REVIEW_DECISION } from '@service-agent-harness/reviews';
import { debounce } from '@solid-primitives/scheduled';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import type { Review, ReviewActions, ReviewDraft } from '../core/review';

/**
 * Serial saves share an acknowledged revision; conflicts never retry a send.
 * The server checks that each selected draft is complete before it claims a
 * batch, and its refusal is shown as the validation message.
 */
export function createReviewController(
  source: Accessor<Review>,
  actions: ReviewActions
) {
  const [saved, setSaved] = createSignal(source());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [saving, setSaving] = createSignal(false);
  const [validation, setValidation] = createSignal<string>();
  const drafts = new Map<string, ReviewDraft>();
  // How each composer serializes its saved draft before any edit, keyed by
  // that saved draft, so opening a card is not mistaken for an edit.
  const untouched = new Map<string, { saved: string; draft: string }>();
  let tail: Promise<void> = Promise.resolve();
  // A poll can return the revision our in-flight save or decision already
  // committed; only a newer revision once our writes settle is someone else's.
  const stale = () =>
    !saving() && !busy() && source().revision > saved().revision;
  const record = () => (stale() ? source() : saved());
  // Acknowledgments and action status can advance without changing editor data.
  // Adopt those revisions only when no local edits or writes can be displaced.
  createEffect(() => {
    const next = source();
    const current = saved();
    if (
      next.revision <= current.revision ||
      busy() ||
      saving() ||
      error() ||
      drafts.size > 0 ||
      next.items.length !== current.items.length ||
      next.items.some(
        (item, index) =>
          item.id !== current.items[index]?.id ||
          JSON.stringify(item.draft) !==
            JSON.stringify(current.items[index]?.draft)
      )
    )
      return;
    setSaved(next);
  });
  async function saveDrafts() {
    if (error()) throw new Error(error());
    for (const [item, draft] of [...drafts]) {
      if (unchanged(item, draft)) {
        if (drafts.get(item) === draft) drafts.delete(item);
        continue;
      }
      const next = await actions.decide({
        action: 'edit',
        revision: saved().revision,
        item,
        draft,
      });
      setSaved(next);
      if (drafts.get(item) === draft) drafts.delete(item);
    }
  }
  async function flush(): Promise<boolean> {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    setSaving(true);
    try {
      await saveDrafts();
      return true;
    } catch {
      setError(
        'This review could not be saved. Your edits remain here. Reload the saved review before trying again.'
      );
      return false;
    } finally {
      setSaving(false);
      release();
    }
  }
  const saveLater = debounce(() => {
    fireAndForget(flush(), 'agent-reviews');
  }, 300);
  function savedDraft(item: string) {
    return JSON.stringify(
      saved().items.find((entry) => entry.id === item)?.draft
    );
  }
  function unchanged(item: string, draft: ReviewDraft) {
    const current = savedDraft(item);
    const next = JSON.stringify(draft.draft);
    if (current === next) return true;

    const initial = untouched.get(item);
    return initial?.saved === current && initial.draft === next;
  }
  /** Record the composer's form of the saved draft it opened with. */
  function baseline(item: string, draft: ReviewDraft) {
    untouched.set(item, {
      saved: savedDraft(item),
      draft: JSON.stringify(draft.draft),
    });
  }
  function edit(item: string, draft: ReviewDraft) {
    if (busy() || error()) return;
    setValidation(undefined);
    if (unchanged(item, draft) && !drafts.has(item)) return;
    drafts.set(item, draft);
    saveLater();
  }
  async function decide(
    action: 'submit' | 'dismiss',
    items: string[]
  ): Promise<boolean> {
    if (busy() || error()) return false;
    setBusy(true);
    saveLater.clear();
    try {
      if (!(await flush())) return false;
      setValidation(undefined);
      setSaved(
        await actions.decide({ action, revision: saved().revision, items })
      );
      return true;
    } catch (failure) {
      if (
        failure instanceof ThrownResultError &&
        thrownResultErrorHasCode(failure, INVALID_REVIEW_DECISION)
      ) {
        setValidation(failure.message);
        return false;
      }
      setError(
        'The review changed or the request could not be confirmed. Reload its saved status before taking another action.'
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function reload(): Promise<boolean> {
    if (busy()) return false;
    setBusy(true);
    saveLater.clear();
    await tail;
    try {
      const next = await actions.reload();
      drafts.clear();
      setValidation(undefined);
      setSaved(next);
      setError(undefined);
      return true;
    } catch {
      setError('The saved review could not be loaded. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  onCleanup(() => saveLater.clear());
  return {
    record,
    busy,
    saving,
    error,
    validation,
    stale,
    baseline,
    edit,
    flush,
    decide,
    reload,
  };
}
