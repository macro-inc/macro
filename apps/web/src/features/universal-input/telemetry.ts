import { type Span, Telemetry } from '@macro-inc/observability';
import type { InputObservation } from './context/telemetry';
import type { Field, Intent } from './core/input';

type DraftTrace = {
  span: Span;
  started: number;
  changed: number;
  revision: number;
  intent?: Intent;
  readyRevision: number;
  readyIntent?: Intent;
  readyValid: boolean;
  firstType: boolean;
  firstFields: boolean;
  firstUsable: boolean;
  predictions: Map<string, number>;
  edited: Set<Field>;
  corrected: Set<Field>;
  calls: number;
  discarded: number;
  coalesced: number;
  overrides: number;
  failures: number;
  finished?: string;
  closedAt?: number;
  submission?: Span;
};

/** App wiring for metadata-only draft traces; state primitives receive only observe(). */
export function createInputTelemetry(
  surface: 'command-menu' | 'mobile-search'
) {
  const drafts = new Map<string, DraftTrace>();
  let disposed = false;
  let activeId: string | undefined;
  const measure = (
    draft: DraftTrace,
    name: string,
    fields: Record<string, string | number | boolean>
  ) => {
    draft.span.event(name, {
      'input.surface': surface,
      'input.intent': draft.intent ?? 'unknown',
      ...fields,
    });
  };
  const finish = (id: string, draft: DraftTrace) => {
    if (!draft.finished) return;
    const pending = draft.predictions.size;
    draft.span.setAttr('input.pending_predictions_on_close', pending);
    draft.span.setAttr('input.submission_pending_on_close', !!draft.submission);
    if (draft.submission) {
      draft.submission.setAttr('input.outcome', 'unknown_after_close');
      draft.submission.end();
    }
    draft.span.setAttr('input.outcome', draft.finished);
    draft.span.setAttr(
      'input.active_ms',
      (draft.closedAt ?? performance.now()) - draft.started
    );
    draft.span.setAttr('input.inference_attempts', draft.calls);
    draft.span.setAttr(
      'input.discarded_predictions',
      draft.discarded + pending
    );
    draft.span.setAttr('input.coalesced_updates', draft.coalesced);
    draft.span.setAttr('input.type_overrides', draft.overrides);
    draft.span.setAttr('input.fields_edited', draft.edited.size);
    draft.span.setAttr('input.fields_corrected', draft.corrected.size);
    draft.span.setAttr('input.failures', draft.failures);
    draft.span.end();
    drafts.delete(id);
    if (activeId === id) activeId = undefined;
  };
  const observe = (event: InputObservation) => {
    if (disposed) return;
    let draft = drafts.get(event.draftId);
    if (!draft && event.event === 'changed' && event.length) {
      const span = Telemetry.span('universal_input.draft');
      span.setAttr('input.draft_id', event.draftId);
      span.setAttr('input.surface', surface);
      span.setAttr('input.intent', event.intent ?? 'unknown');
      draft = {
        span,
        started: performance.now(),
        changed: performance.now(),
        revision: event.revision,
        readyRevision: -1,
        readyValid: false,
        firstType: false,
        firstFields: false,
        firstUsable: false,
        predictions: new Map(),
        edited: new Set(),
        corrected: new Set(),
        calls: 0,
        discarded: 0,
        coalesced: 0,
        overrides: 0,
        failures: 0,
      };
      drafts.set(event.draftId, draft);
      activeId = event.draftId;
    }
    if (!draft) return;
    switch (event.event) {
      case 'changed':
        draft.revision = event.revision;
        draft.changed = performance.now();
        draft.intent = event.intent;
        draft.span.setAttr('input.length', event.length);
        draft.span.setAttr('input.revision', event.revision);
        break;
      case 'queue':
        if (event.observation.action === 'started') {
          draft.coalesced += event.observation.coalesced;
          measure(draft, 'universal_input.queue', {
            'input.phase': event.phase,
            'input.queue_ms': event.observation.waitMs,
            'input.coalesced_updates': event.observation.coalesced,
          });
        }
        break;
      case 'prediction': {
        const key = `${event.phase}:${event.revision}`;
        if (event.outcome === 'started') {
          draft.calls++;
          draft.predictions.set(key, performance.now());
          break;
        }
        const started = draft.predictions.get(key);
        draft.predictions.delete(key);
        if (event.outcome === 'discarded') draft.discarded++;
        if (event.outcome === 'error') draft.failures++;
        measure(draft, 'universal_input.prediction', {
          'input.phase': event.phase,
          ...(event.intent && { 'input.intent': event.intent }),
          'input.revision': event.revision,
          'input.outcome': event.outcome,
          'input.current_revision': event.revision === draft.revision,
          ...(started !== undefined && {
            'input.prediction_ms': performance.now() - started,
          }),
          ...(event.failure && { 'error.type': event.failure }),
        });
        finish(event.draftId, draft);
        break;
      }
      case 'type':
        draft.intent = event.intent;
        draft.span.setAttr('input.intent', event.intent ?? 'unknown');
        if (
          event.manual &&
          event.previous &&
          event.intent &&
          event.previous !== event.intent
        ) {
          draft.overrides++;
          measure(draft, 'universal_input.type_override', {
            'input.previous_intent': event.previous,
            'input.selected_intent': event.intent,
          });
        }
        if (event.intent && !draft.firstType) {
          draft.firstType = true;
          measure(draft, 'universal_input.type_ready', {
            'input.type_ready_ms': performance.now() - draft.started,
          });
        }
        break;
      case 'field':
        if (!draft.edited.has(event.field)) {
          draft.edited.add(event.field);
          if (event.inferred) draft.corrected.add(event.field);
          measure(draft, 'universal_input.field_edit', {
            'input.field': event.field,
            'input.corrected_suggestion': event.inferred,
          });
        }
        break;
      case 'ready':
        if (
          draft.readyRevision !== event.revision ||
          draft.readyIntent !== event.intent ||
          (event.valid && !draft.readyValid)
        ) {
          draft.readyRevision = event.revision;
          draft.readyIntent = event.intent;
          draft.readyValid = event.valid;
          measure(draft, 'universal_input.fields_ready', {
            'input.valid': event.valid,
            'input.fields_ready_ms': performance.now() - draft.changed,
            'input.first_form': !draft.firstFields,
            'input.first_form_ms': performance.now() - draft.started,
            'input.first_usable': event.valid && !draft.firstUsable,
            ...(event.valid &&
              !draft.firstUsable && {
                'input.first_usable_ms': performance.now() - draft.started,
              }),
          });
          draft.firstFields = true;
          if (event.valid) draft.firstUsable = true;
        }
        break;
      case 'blocked':
        measure(draft, 'universal_input.submission_blocked', {
          'input.operation': event.operation,
          'input.blocked_reason': event.reason,
        });
        break;
      case 'submission':
        if (event.outcome === 'started') {
          draft.submission = draft.span.span('universal_input.submit');
          draft.submission.setAttr('input.surface', surface);
          draft.submission.setAttr('input.intent', event.intent);
          draft.submission.setAttr('input.operation', event.operation);
          break;
        }
        draft.submission?.setAttr('input.outcome', event.outcome);
        if (event.outcome === 'error') {
          draft.failures++;
          draft.submission?.setAttr('error.type', event.failure ?? 'unknown');
          draft.submission?.error('Universal Input submission failed');
        }
        draft.submission?.end();
        draft.submission = undefined;
        finish(event.draftId, draft);
        break;
      case 'finished':
        draft.finished = event.outcome;
        draft.closedAt = performance.now();
        if (activeId === event.draftId) activeId = undefined;
        finish(event.draftId, draft);
        break;
    }
  };
  return {
    observe,
    dispose() {
      for (const draftId of drafts.keys())
        observe({ event: 'finished', draftId, outcome: 'abandoned' });
      disposed = true;
    },
    parent: () => (activeId ? drafts.get(activeId)?.span : undefined),
    run<T>(operation: () => T): T {
      const draft = activeId ? drafts.get(activeId) : undefined;
      const span = draft?.submission ?? draft?.span;
      return span ? span.run(operation) : operation();
    },
  };
}
