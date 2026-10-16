import { debounce } from '@solid-primitives/scheduled';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import type { Review, ReviewActions, ReviewItem } from '../core/review';

/** Serial saves share an acknowledged revision; conflicts never retry a send. */
export function createReviewController(
  source: Accessor<Review>,
  actions: ReviewActions,
  validateDraft?: (item: ReviewItem, kind: Review['kind']) => string | undefined
) {
  const [saved, setSaved] = createSignal(source());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [saving, setSaving] = createSignal(false);
  const [validation, setValidation] = createSignal<{
    item: string;
    message: string;
  }>();
  const drafts = new Map<string, unknown>();
  let tail: Promise<void> = Promise.resolve();
  const record = () =>
    source().revision > saved().revision ? source() : saved();
  const stale = () => source().revision > saved().revision;
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
    void flush();
  }, 300);
  function edit(item: string, draft: unknown) {
    if (busy() || error()) return;
    setValidation(undefined);
    const existing = saved().items.find((entry) => entry.id === item);
    if (JSON.stringify(existing?.draft) === JSON.stringify(draft)) return;
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
      if (action === 'submit' && validateDraft) {
        for (const item of record().items) {
          if (
            item.status !== 'pending' ||
            (items.length > 0 && !items.includes(item.id))
          )
            continue;
          const message = validateDraft(item, record().kind);
          if (message) {
            setValidation({ item: item.id, message });
            return false;
          }
        }
      }
      setValidation(undefined);
      setSaved(
        await actions.decide({ action, revision: saved().revision, items })
      );
      return true;
    } catch {
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
    edit,
    flush,
    decide,
    reload,
  };
}
