import { debounce } from '@solid-primitives/scheduled';
import { batch, createSignal, onCleanup } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import type { InputCapabilities } from '../context/capabilities';
import {
  applySuggestions,
  emptyDraft,
  type Field,
  fieldsSchema,
  type Intent,
  inferIntent,
  missingFields,
  type Scores,
  type Submission,
  type SubmissionResult,
  updateDraftText,
} from '../core/input';

export function createUniversalInput(source: InputCapabilities) {
  const [draft, setDraft] = createSignal(source.readDraft() ?? emptyDraft());
  const [scores, setScores] = createSignal<Scores>([]);
  const [pending, setPending] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [result, setResult] = createSignal<SubmissionResult>();
  let revision = 0;
  let disposed = false;
  let running = false;
  let queued = false;
  let submissionId = draft().submissionId ?? uuidv7();
  const fields = () =>
    fieldsSchema.parse(draft().intent ? draft().fields[draft().intent!] : {});
  const persist = () => source.saveDraft(draft());
  const inferenceFailed = (failure: unknown, classifying: boolean) => {
    setDraft((d) =>
      classifying ? { ...d, intent: undefined } : updateDraftText(d, d.text)
    );
    setError(
      failure instanceof Error
        ? failure.message
        : 'Detection unavailable. Choose a type and fill in the fields.'
    );
    persist();
  };
  const infer = async () => {
    if (disposed || !draft().text.trim() || sending()) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    queued = false;
    const version = revision;
    const current = draft();
    const fresh = () => !disposed && revision === version;
    let classifying = !current.locked;
    setPending(true);
    try {
      let intent = current.intent;
      if (!current.locked) {
        const classified = await source.classify(current.text, version);
        if (!fresh() || classified.revision !== version) return;
        intent = inferIntent(classified.scores);
        classifying = false;
        batch(() => {
          setScores(classified.scores);
          setDraft((d) => ({ ...d, intent }));
        });
      }
      if (intent && intent !== 'ai') {
        const extracted = await source.extract(current.text, intent, version);
        if (
          !fresh() ||
          extracted.revision !== version ||
          extracted.intent !== intent
        )
          return;
        const target = intent;
        setDraft((d) => ({
          ...d,
          fields: {
            ...d.fields,
            [target]: applySuggestions(
              d.fields[target],
              d.edited[target],
              extracted.suggestions
            ),
          },
        }));
      }
      if (fresh()) {
        setError('');
        persist();
      }
    } catch (failure) {
      if (fresh()) inferenceFailed(failure, classifying);
    } finally {
      running = false;
      if (!disposed) {
        setPending(queued || (revision !== version && !!draft().text.trim()));
        if (queued) void infer();
      }
    }
  };
  const schedule = debounce(() => void infer(), 500);
  const changed = () => {
    revision++;
    setError('');
    setResult(undefined);
    if (draft().text.trim()) setDraft((d) => ({ ...d, submissionId }));
    persist();
    if (draft().text.trim()) {
      setPending(true);
      schedule();
    } else {
      schedule.clear();
      setPending(false);
    }
  };
  const setText = (text: string) => {
    if (sending()) return;
    if (!text.trim()) {
      queued = false;
      setDraft(emptyDraft());
      setScores([]);
      submissionId = uuidv7();
    } else setDraft((d) => ({ ...d, text }));
    changed();
  };
  const choose = (intent?: Intent) => {
    if (sending()) return;
    setDraft((d) => ({ ...d, intent, locked: !!intent }));
    changed();
  };
  const edit = (key: Field, value: string) => {
    const intent = draft().intent;
    if (!intent || sending()) return;
    setDraft((d) => ({
      ...d,
      locked: true,
      fields: { ...d.fields, [intent]: { ...d.fields[intent], [key]: value } },
      edited: {
        ...d.edited,
        [intent]: [...new Set([...d.edited[intent], key])],
      },
    }));
    changed();
  };
  const snapshot = (): Submission | undefined => {
    const d = draft();
    return d.intent
      ? { intent: d.intent, text: d.text, fields: fields(), id: submissionId }
      : undefined;
  };
  const validation = () => {
    const input = snapshot();
    return input
      ? (missingFields(input) ?? source.validate(input))
      : 'Choose a type';
  };
  const submit = async () => {
    const input = snapshot();
    if (!input || sending() || pending() || validation()) return;
    setSending(true);
    revision++;
    schedule.clear();
    try {
      const saved = await source.submit(input);
      source.saveDraft(emptyDraft());
      if (disposed) return;
      batch(() => {
        setDraft(emptyDraft());
        setScores([]);
        setError('');
        setResult(saved);
      });
      submissionId = uuidv7();
      persist();
    } catch (failure) {
      if (!disposed)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not complete the action. Your draft is saved.'
        );
    } finally {
      if (!disposed) setSending(false);
    }
  };
  if (draft().text.trim()) {
    setPending(true);
    schedule();
  }
  onCleanup(() => {
    disposed = true;
    revision++;
    schedule.clear();
  });
  return {
    draft,
    fields,
    scores,
    pending,
    sending,
    error,
    result,
    setText,
    choose,
    edit,
    submit,
    validation,
  };
}
export type UniversalInputController = ReturnType<typeof createUniversalInput>;
