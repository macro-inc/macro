import { batch, createSignal, onCleanup } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import { parseSearchFilters } from '../../next-soup/core/search-filters';
import type { InputCapabilities } from '../context/capabilities';
import type { InputPhase } from '../context/telemetry';
import { InputInferenceError, inputFailure } from '../core/failure';
import {
  applySuggestions,
  emptyDraft,
  type Field,
  fieldsSchema,
  type Intent,
  inferIntent,
  missingFields,
  rankIntents,
  type Scores,
  type Submission,
  type SubmissionResult,
  updateDraftText,
} from '../core/input';
import { localFields } from '../core/local-fields';
import { createInferenceQueue } from './inference-queue';

export function createUniversalInput(source: InputCapabilities) {
  const [draft, setDraft] = createSignal(source.initialDraft ?? emptyDraft());
  const [scores, setScores] = createSignal<Scores>([]);
  const [revision, setRevision] = createSignal(0);
  const [classifiedRevision, setClassifiedRevision] = createSignal(-1);
  const [extracted, setExtracted] = createSignal<{
    revision: number;
    intent: Intent;
  }>();
  const [operation, setOperation] = createSignal<
    'submit' | 'save-email-draft'
  >();
  const sending = () => operation() !== undefined;
  const savingEmailDraft = () => operation() === 'save-email-draft';
  const [classificationError, setClassificationError] = createSignal('');
  const [extractionError, setExtractionError] = createSignal('');
  const [submissionError, setSubmissionError] = createSignal('');
  const error = () =>
    submissionError() || extractionError() || classificationError();
  const [result, setResult] = createSignal<SubmissionResult>();
  let decisionRevision = 0;
  let disposed = false;
  let submissionId = draft().submissionId ?? uuidv7();
  const suggestedFields = new Map<Intent, Set<Field>>();
  const observePrediction = (
    input: { draftId: string; revision: number; intent?: Intent },
    phase: InputPhase,
    outcome: 'started' | 'applied' | 'discarded' | 'error',
    failure?: unknown
  ) =>
    source.observe?.({
      event: 'prediction',
      draftId: input.draftId,
      phase,
      revision: input.revision,
      intent: input.intent,
      outcome,
      ...(failure !== undefined && { failure: inputFailure(failure) }),
    });
  const fields = () =>
    fieldsSchema.parse(draft().intent ? draft().fields[draft().intent!] : {});
  const pending = () => {
    const current = draft();
    if (!current.text.trim()) return false;
    if (
      current.intent === 'search' &&
      extractionError() &&
      !(['query', 'searchFilters'] as const).every((field) =>
        current.edited.search.includes(field)
      )
    )
      return true;
    if (!current.locked && classifiedRevision() !== revision()) return true;
    return (
      !!current.intent &&
      current.intent !== 'ai' &&
      (extracted()?.revision !== revision() ||
        extracted()?.intent !== current.intent)
    );
  };
  const usable = (decision: number) =>
    !disposed && decisionRevision === decision && !!draft().text.trim();
  const seed = () => {
    setDraft((current) => {
      const intent = current.intent;
      if (!intent) return current;
      if (
        extracted()?.revision === revision() &&
        extracted()?.intent === intent
      )
        return current;
      return {
        ...current,
        intent,
        fields: {
          ...current.fields,
          [intent]: applySuggestions(
            current.fields[intent],
            current.edited[intent],
            localFields(current.text, intent)
          ),
        },
      };
    });
  };
  const classificationQueue = createInferenceQueue({
    observe: (observation) =>
      source.observe?.({
        event: 'queue',
        draftId: submissionId,
        phase: 'classify',
        observation,
      }),
    read: () =>
      !disposed && !sending() && draft().text.trim() && !draft().locked
        ? {
            draftId: submissionId,
            text: draft().text,
            revision: revision(),
            decision: decisionRevision,
          }
        : undefined,
    key: (input) => String(input.revision),
    async run(input) {
      observePrediction(input, 'classify', 'started');
      try {
        const response = await source.classify(input.text, input.revision);
        if (!usable(input.decision) || draft().locked) {
          observePrediction(input, 'classify', 'discarded');
          return;
        }
        if (response.revision !== input.revision)
          throw new InputInferenceError('invalid_response');
        const previousIntent = draft().intent;
        const intent = inferIntent(response.scores);
        batch(() => {
          setScores(response.scores);
          setDraft((current) => ({ ...current, intent }));
          setClassifiedRevision(input.revision);
          setClassificationError('');
          seed();
        });
        source.observe?.({
          event: 'type',
          draftId: input.draftId,
          previous: previousIntent,
          intent,
          manual: false,
        });
        observePrediction({ ...input, intent }, 'classify', 'applied');
        // A newly recognized type extracts the newest text on its own queue.
        extractionQueue.enqueue(intent !== previousIntent);
      } catch (failure) {
        if (!usable(input.decision) || revision() !== input.revision) {
          observePrediction(input, 'classify', 'discarded', failure);
          return;
        }
        observePrediction(input, 'classify', 'error', failure);
        source.observe?.({
          event: 'type',
          draftId: input.draftId,
          previous: draft().intent,
          intent: undefined,
          manual: false,
        });
        setDraft((current) => ({ ...current, intent: undefined }));
        setClassifiedRevision(input.revision);
        setClassificationError(
          failure instanceof Error
            ? failure.message
            : 'Detection unavailable. Choose a type to continue.'
        );
      }
    },
  });
  const extractionQueue = createInferenceQueue({
    observe: (observation) =>
      source.observe?.({
        event: 'queue',
        draftId: submissionId,
        phase: 'extract',
        observation,
      }),
    read: () => {
      const current = draft();
      if (
        disposed ||
        sending() ||
        !current.text.trim() ||
        !current.intent ||
        current.intent === 'ai'
      )
        return;
      return {
        draftId: submissionId,
        text: current.text,
        intent: current.intent,
        searchType:
          current.intent === 'search' &&
          current.edited.search.includes('searchFilters')
            ? parseSearchFilters(current.fields.search.searchFilters ?? '').type
            : undefined,
        revision: revision(),
        decision: decisionRevision,
      };
    },
    key: (input) => `${input.revision}:${input.intent}`,
    async run(input) {
      observePrediction(input, 'extract', 'started');
      try {
        const response = input.searchType
          ? await source.extract(
              input.text,
              input.intent,
              input.revision,
              input.searchType
            )
          : await source.extract(input.text, input.intent, input.revision);
        if (
          !usable(input.decision) ||
          revision() !== input.revision ||
          draft().intent !== input.intent
        ) {
          observePrediction(input, 'extract', 'discarded');
          return;
        }
        if (
          response.revision !== input.revision ||
          response.intent !== input.intent
        )
          throw new InputInferenceError('invalid_response');
        const suggested = new Set<Field>();
        for (const [key, value] of Object.entries(response.suggestions)) {
          const field = fieldsSchema
            .keyof()
            .safeParse(key === 'properties' ? 'taskProperties' : key);
          if (
            field.success &&
            value != null &&
            value !== '' &&
            (!Array.isArray(value) || value.length)
          )
            suggested.add(field.data);
        }
        suggestedFields.set(input.intent, suggested);
        setDraft((current) => ({
          ...current,
          fields: {
            ...current.fields,
            [input.intent]: applySuggestions(
              current.fields[input.intent],
              current.edited[input.intent],
              response.suggestions
            ),
          },
        }));
        setExtractionError('');
        setExtracted({ revision: input.revision, intent: input.intent });
        observePrediction(input, 'extract', 'applied');
      } catch (failure) {
        if (
          !usable(input.decision) ||
          revision() !== input.revision ||
          draft().intent !== input.intent
        ) {
          observePrediction(input, 'extract', 'discarded', failure);
          return;
        }
        observePrediction(input, 'extract', 'error', failure);
        setDraft((current) => updateDraftText(current, current.text));
        seed();
        setExtractionError(
          failure instanceof Error
            ? failure.message
            : 'Could not extract fields. Fill them in to continue.'
        );
        setExtracted({ revision: input.revision, intent: input.intent });
      }
    },
  });
  const changed = (reason: 'text' | 'type' | 'field') => {
    setRevision((value) => value + 1);
    setClassificationError('');
    setExtractionError('');
    setSubmissionError('');
    setResult(undefined);
    source.observe?.({
      event: 'changed',
      draftId: submissionId,
      revision: revision(),
      length: draft().text.length,
      intent: draft().intent,
      reason,
    });
    if (draft().text.trim()) {
      seed();
      setDraft((current) => ({ ...current, submissionId }));
      if (draft().locked) classificationQueue.clear();
      else classificationQueue.enqueue();
      extractionQueue.enqueue();
    } else {
      classificationQueue.clear();
      extractionQueue.clear();
    }
  };
  const setText = (text: string) => {
    if (sending()) return;
    batch(() => {
      if (!text.trim()) {
        classificationQueue.clear();
        extractionQueue.clear();
        source.observe?.({
          event: 'finished',
          draftId: submissionId,
          outcome: 'cleared',
        });
        decisionRevision++;
        setDraft(emptyDraft());
        setScores([]);
        suggestedFields.clear();
        submissionId = uuidv7();
      } else setDraft((d) => ({ ...d, text }));
      changed('text');
    });
  };
  const choose = (intent?: Intent) => {
    if (sending()) return;
    batch(() => {
      source.observe?.({
        event: 'type',
        draftId: submissionId,
        previous: draft().intent,
        intent,
        manual: true,
      });
      decisionRevision++;
      setDraft((d) => ({ ...d, intent, locked: !!intent }));
      changed('type');
    });
  };
  const cycle = (direction = 1) => {
    const candidates = rankIntents(scores());
    if (candidates.length < 2 || sending()) return;
    const index = candidates.findIndex((c) => c.intent === draft().intent);
    const next = (index + direction + candidates.length) % candidates.length;
    choose(candidates[next].intent);
  };
  const edit = (key: Field, value: string) => {
    const intent = draft().intent;
    if (!intent || sending()) return;
    if (fields()[key] !== value)
      source.observe?.({
        event: 'field',
        draftId: submissionId,
        intent,
        field: key,
        inferred:
          !!suggestedFields.get(intent)?.has(key) && fields()[key] !== value,
      });
    batch(() => {
      decisionRevision++;
      setDraft((d) => ({
        ...d,
        locked: true,
        fields: {
          ...d.fields,
          [intent]: { ...d.fields[intent], [key]: value },
        },
        edited: {
          ...d.edited,
          [intent]: [...new Set([...d.edited[intent], key])],
        },
      }));
      changed('field');
    });
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
  const emailDraftValidation = () => {
    const input = snapshot();
    if (input?.intent !== 'email') return 'Choose Email';
    if (!input.text.trim()) return 'Type something to begin';
    return source.validateEmailDraft(input);
  };
  const observeReady = () => {
    const intent = draft().intent;
    if (intent && draft().text.trim() && !pending())
      source.observe?.({
        event: 'ready',
        draftId: submissionId,
        revision: revision(),
        intent,
        valid: !validation(),
      });
  };
  const complete = async (
    input: Submission,
    operation: 'submit' | 'save-email-draft',
    perform: (input: Submission) => Promise<SubmissionResult>
  ) => {
    const draftId = submissionId;
    source.observe?.({
      event: 'submission',
      draftId,
      operation,
      intent: input.intent,
      outcome: 'started',
    });
    setOperation(operation);
    let completed = false;
    decisionRevision++;
    classificationQueue.clear();
    extractionQueue.clear();
    try {
      const saved = await perform(input);
      source.observe?.({
        event: 'submission',
        draftId,
        operation,
        intent: input.intent,
        outcome: 'success',
      });
      if (disposed) return;
      batch(() => {
        setDraft(emptyDraft());
        setScores([]);
        setSubmissionError('');
        setResult(saved);
      });
      suggestedFields.clear();
      submissionId = uuidv7();
      completed = true;
    } catch (failure) {
      source.observe?.({
        event: 'submission',
        draftId,
        operation,
        intent: input.intent,
        outcome: 'error',
        failure: inputFailure(failure),
      });
      if (!disposed)
        setSubmissionError(
          failure instanceof Error
            ? failure.message
            : 'Could not complete the action. Your draft is saved.'
        );
    } finally {
      if (!disposed) {
        setOperation(undefined);
        if (completed) {
          source.observe?.({
            event: 'finished',
            draftId,
            outcome: operation === 'submit' ? 'submitted' : 'saved',
          });
          source.onSubmitted?.();
        }
      }
    }
  };
  const submit = async () => {
    const input = snapshot();
    if (!input || sending() || pending() || validation()) {
      source.observe?.({
        event: 'blocked',
        draftId: submissionId,
        operation: 'submit',
        reason: !draft().text.trim()
          ? 'empty'
          : sending()
            ? 'sending'
            : pending()
              ? 'pending'
              : 'validation',
      });
      return;
    }
    await complete(input, 'submit', source.submit);
  };
  const saveEmailDraft = async () => {
    const input = snapshot();
    if (!input || sending() || pending() || emailDraftValidation()) {
      source.observe?.({
        event: 'blocked',
        draftId: submissionId,
        operation: 'save-email-draft',
        reason: !draft().text.trim()
          ? 'empty'
          : sending()
            ? 'sending'
            : pending()
              ? 'pending'
              : 'validation',
      });
      return;
    }
    await complete(input, 'save-email-draft', source.saveEmailDraft);
  };
  if (draft().text.trim()) {
    source.observe?.({
      event: 'changed',
      draftId: submissionId,
      revision: revision(),
      length: draft().text.length,
      reason: 'text',
      intent: draft().intent,
    });
    seed();
    classificationQueue.enqueue();
    extractionQueue.enqueue();
  }
  onCleanup(() => {
    disposed = true;
    classificationQueue.dispose();
    extractionQueue.dispose();
    source.observe?.({
      event: 'finished',
      draftId: submissionId,
      outcome: 'abandoned',
    });
  });
  return {
    draft,
    observeReady,
    fields,
    scores,
    pending,
    sending,
    savingEmailDraft,
    error,
    result,
    setText,
    choose,
    cycle,
    edit,
    submit,
    saveEmailDraft,
    validation,
    emailDraftValidation,
  };
}
export type UniversalInputController = ReturnType<typeof createUniversalInput>;
