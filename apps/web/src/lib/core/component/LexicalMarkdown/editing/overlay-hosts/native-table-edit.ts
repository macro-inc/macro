import type { EditorView } from '@macro-inc/lexical-wasm-view';
import {
  createInputCommitObservation,
  type InputCommitObservationState,
} from '@macro-inc/lexical-wasm-view/view/input-commit-observation';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import type { JsonValue } from '@macro-inc/lexical-wasm-view/view/types';
import { Telemetry } from '@macro-inc/observability';
import { dispatchApplicationCommandSettledIfSessionEdit } from '../../plugins/group-b/command';

/**
 * What one table edit did. `published` is the input's OWN entry evidence
 * (published with the main command handled), never inferred from an attempt
 * or from the settlement alone: a cancelled, refused or failed entry is not
 * published, and an observer that throws after publication still reports it.
 */
export type NativeTableEditOutcome =
  /** The host refused before queueing (disposed, unmounted, no edit). */
  | { readonly kind: 'refused' }
  | {
      readonly kind: 'settled';
      readonly settlement: InputSettlement;
      readonly evidence: InputCommitObservationState;
      readonly published: boolean;
    }
  /**
   * The dispatch rejected (e.g. a commit observer threw). The entry may still
   * have published: its own evidence says, read after the rejection.
   */
  | {
      readonly kind: 'failed';
      readonly error: unknown;
      readonly evidence: InputCommitObservationState;
      readonly published: boolean;
    };

export const tableEditPublished = (outcome: NativeTableEditOutcome) =>
  outcome.kind !== 'refused' && outcome.published;

const publishedBy = (evidence: InputCommitObservationState) =>
  evidence.status === 'published' && evidence.mainHandled === true;

/**
 * One `group-b.table` input through current SessionEdit admission: `payload`
 * and `admit` run at actual entry (after any queued input ahead of it), and
 * the entry's own main-commit evidence decides `published`. Never rejects.
 */
export async function settleNativeTableEdit(
  view: EditorView,
  operation: string,
  payload: () => JsonValue,
  admit: () => boolean
): Promise<NativeTableEditOutcome> {
  const span =
    view.options.parentSpan?.span('editor.table.edit') ??
    Telemetry.span('editor.table.edit');
  span.setAttr('operation', operation);
  const mainCommit = createInputCommitObservation();
  try {
    const settlement = await span.run(() =>
      dispatchApplicationCommandSettledIfSessionEdit(
        view,
        'group-b.table',
        payload,
        { admit, mainCommit }
      )
    );
    const evidence = mainCommit.read();
    const published = publishedBy(evidence);
    span.setAttr('settlement', settlement.status);
    span.setAttr('published', published);
    if (settlement.status === 'error') span.error(settlement.error);
    return { kind: 'settled', settlement, evidence, published };
  } catch (error) {
    span.error(error);
    const evidence = mainCommit.read();
    const published = publishedBy(evidence);
    span.setAttr('published', published);
    return { kind: 'failed', error, evidence, published };
  } finally {
    span.end();
  }
}
