import { fireAndForget } from '@core/util/fireAndForget';
import {
  createInputCommitObservation,
  type EditorView,
  type InputCommitObservationState,
} from '@macro-inc/lexical-wasm-view';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import {
  SessionPort,
  selectionMessage,
} from '@macro-inc/lexical-wasm-view/view/session-port';
import type { JsonValue } from '@macro-inc/lexical-wasm-view/view/types';
import { Telemetry } from '@macro-inc/observability';
import type { ActionContext } from '../../plugins/actions/types';
import {
  type CreationKind,
  openCreationComposer,
  trackSlashCreatedMention,
} from './creation';

/** @internal Pure classification only; this does not validate native receipt authority. */
export function matchesCreationCancellation(
  evidence: InputCommitObservationState,
  reason: Extract<InputSettlement, { status: 'cancelled' }>['reason']
): boolean {
  return (
    evidence.status === 'not-entered' &&
    evidence.cause.status === 'cancelled' &&
    evidence.cause.reason === reason
  );
}

/** A retained popover owns its operation queue, never a saved editor selection. */
export function createNativeCreationComposerController(view: EditorView) {
  const port = view.port;
  if (!(port instanceof SessionPort))
    throw new Error('Native creation requires the session port');
  let disposed = false;

  return {
    requestCreation(kind: CreationKind, context?: ActionContext): boolean {
      const generation = view.mirror.keyGeneration;
      if (disposed || !view.isMounted || generation === null) return false;

      return openCreationComposer(kind, (awaitId) => {
        let placeholderInserted = false;
        let terminal:
          | { status: 'error'; error: unknown }
          | { status: 'cancelled' }
          | undefined;
        // Retain copied evidence independently of the Source logical flag,
        // including a published input whose later output consumption failed.
        const attempts: Array<{ evidence: InputCommitObservationState }> = [];
        let pending = Promise.resolve();
        const current = () =>
          !disposed &&
          terminal === undefined &&
          view.isMounted &&
          view.port === port &&
          view.mirror.keyGeneration === generation;

        const enqueue = (
          operation: () => Promise<void>,
          trace = Telemetry.captureContext()
        ) => {
          const enqueuedAt = performance.now();
          const result = pending.then(async () => {
            if (disposed || terminal !== undefined) return;
            let operationPromise: Promise<void> | undefined;
            let observedOperation: Promise<void> | undefined;
            let observedSpan: Promise<void> | undefined;
            try {
              return await trace.run(() => {
                const spanPromise = Telemetry.span(
                  'editor.creation.operation',
                  (span) => {
                    span.setAttr('creation.await_id', awaitId);
                    span.setAttr('creation.kind', kind);
                    span.setAttr(
                      'queue.wait_ms',
                      performance.now() - enqueuedAt
                    );
                    operationPromise = operation();
                    observedOperation = operationPromise.then(
                      () => undefined,
                      () => undefined
                    );
                    return operationPromise.then(
                      () => span.setAttr('outcome', 'completed'),
                      (error: unknown) => {
                        span.setAttr('outcome', 'error');
                        throw error;
                      }
                    );
                  }
                );
                observedSpan = spanPromise.then(
                  () => undefined,
                  () => undefined
                );
                return spanPromise;
              });
            } catch (error) {
              // Observe both real promises even when context cleanup throws
              // synchronously. Wait for the original operation, never retry it
              // or release this FIFO while its native outcome is still pending.
              if (observedOperation) await observedOperation;
              if (observedSpan) await observedSpan;
              if (operationPromise) await operationPromise;
              throw error;
            }
          });
          pending = result.catch((error: unknown) => {
            terminal ??= { status: 'error', error };
          });
          return result;
        };
        const command = async (name: string, payload: JsonValue) => {
          const observation = createInputCommitObservation();
          const attempt = { evidence: observation.read() };
          attempts.push(attempt);
          try {
            const result = await port.inputSettledIfSessionEdit(
              () => ({
                name,
                json: JSON.stringify(payload),
                generation,
                selection: selectionMessage({ kind: 'keep' }),
              }),
              { admit: current, mainCommit: observation }
            );
            const evidence = observation.read();
            attempt.evidence = evidence;
            if (result.status === 'error') throw result.error;
            if (result.status === 'cancelled') {
              if (!matchesCreationCancellation(evidence, result.reason))
                throw new Error(
                  'Native creation cancellation has no matching receipt'
                );
              // Cancellation is not a completed Source dispatch. Keep the
              // previous flag and any earlier receipts; never insert fallback.
              terminal = { status: 'cancelled' };
              return undefined;
            }
            if (
              evidence.status !== 'published' ||
              evidence.mainHandled !== result.handled
            )
              throw new Error('Native creation input has no matching commit');
            return result.handled;
          } catch (error) {
            // The pure handle remains readable even after a synchronous opaque
            // throw. Retain it without treating failure as transaction rollback.
            attempt.evidence = observation.read();
            terminal = { status: 'error', error };
            throw error;
          }
        };

        return {
          onCreateStart: ({ title }) => {
            fireAndForget(
              enqueue(async () => {
                const handled = await command('group-b.creation-await-insert', {
                  awaitId,
                  text: `Creating ${title}`,
                });
                if (handled !== undefined) placeholderInserted = handled;
              }),
              'native-creation-start'
            );
          },
          onCreateFailure: () => {
            fireAndForget(
              enqueue(async () => {
                if (!placeholderInserted) return;
                const handled = await command(
                  'group-b.creation-await-resolve',
                  {
                    awaitId,
                  }
                );
                if (handled !== undefined) placeholderInserted = false;
              }),
              'native-creation-failure'
            );
          },
          onSuccess: async (result) => {
            const trace = Telemetry.captureContext();
            // Source starts tracking outside placeholder dispatch. A failure
            // callback must remain able to delete while this await is pending.
            // Its rejection does not retire the native operation queue.
            const mentionUuid = await trackSlashCreatedMention(
              context,
              result.documentId
            );
            return enqueue(async () => {
              const mention = {
                documentId: result.documentId,
                documentName: result.title,
                blockName: kind === 'task' ? 'task' : 'md',
                ...(mentionUuid === undefined ? {} : { mentionUuid }),
              };
              if (placeholderInserted) {
                const handled = await command(
                  'group-b.creation-await-resolve',
                  {
                    awaitId,
                    replacement: mention,
                  }
                );
                if (handled !== undefined) placeholderInserted = false;
                return;
              }
              await command('group-b.insert-document-mention', mention);
            }, trace);
          },
        };
      });
    },
    dispose() {
      disposed = true;
    },
  };
}
