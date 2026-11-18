import { toast } from '@core/component/Toast/Toast';
import {
  createInputCommitObservation,
  type DatabaseCommitEvidence,
  type EditorView,
} from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import type { ActionContext } from '../../plugins/actions/types';
import {
  dispatchApplicationCommandSettledIfSessionEdit,
  queryApplication,
} from '../../plugins/group-b/command';

/** Each create owns its actual native Await and survives movement of the caret. */
export function createNativeDatabaseController(view: EditorView) {
  let disposed = false;
  return {
    dispose() {
      disposed = true;
    },
    async requestDatabase(context?: ActionContext): Promise<void> {
      const generation = view.mirror.keyGeneration;
      const current = () =>
        !disposed && view.isMounted && view.mirror.keyGeneration === generation;
      if (generation === null || !current() || !view.isEditable) return;
      const requestContext = Telemetry.captureContext();
      let key: number | undefined;
      let inserted = false;
      let untrack: (() => Promise<void>) | undefined;
      const command = async (
        name: string,
        payload: () => { [key: string]: string | number },
        observe?: (result: DatabaseCommitEvidence) => void
      ) => {
        const evidence = createInputCommitObservation((entry) => {
          if (entry.status === 'published' && entry.database)
            observe?.(entry.database);
        });
        const result = await dispatchApplicationCommandSettledIfSessionEdit(
          view,
          name,
          payload,
          { admit: current, mainCommit: evidence }
        );
        if (result.status === 'error') throw result.error;
        if (result.status === 'cancelled') return false;
        const entry = evidence.read();
        if (
          entry.status !== 'published' ||
          !entry.database ||
          entry.database.kind === 'invalid'
        )
          throw new Error('Native Database operation has no committed result');
        return true;
      };
      const pending = () => {
        if (!current() || key === undefined) return false;
        const target = queryApplication(view, 'group-b.database-target', {
          key,
        });
        if (
          !target ||
          typeof target !== 'object' ||
          !('isAwait' in target) ||
          typeof target.isAwait !== 'boolean'
        )
          throw new Error('Invalid native Database target');
        return target.isAwait;
      };
      try {
        try {
          if (
            !(await command(
              'group-b.database-create-start',
              () => ({}),
              (result) => {
                if (result.kind === 'started') key = result.key;
              }
            ))
          )
            return;
          if (key === undefined)
            throw new Error('Native Database start did not insert an Await');
          // Source downloads the service implementation only after inserting its Await.
          const { createAndTrackDatabase } = await import(
            './native-insert-database'
          );
          if (!pending() || !view.isEditable) return;
          const created = await requestContext.run(() =>
            createAndTrackDatabase(context, () => pending() && view.isEditable)
          );
          if (!created) return;
          untrack = created.untrack;
          if (!pending() || !view.isEditable) return;
          const target = key;
          await command(
            'group-b.database-create-complete',
            () => ({
              key: target,
              documentId: created.id,
              ...(created.mentionUuid
                ? { mentionUuid: created.mentionUuid }
                : {}),
            }),
            (result) => {
              if (result.kind === 'inserted') inserted = true;
            }
          );
        } finally {
          if (!inserted) {
            try {
              // Session access is checked again at entry. Never mutate a retired generation.
              if (current() && key !== undefined) {
                const target = key;
                await command('group-b.database-remove-any', () => ({
                  key: target,
                }));
              }
            } finally {
              await untrack?.();
            }
          }
        }
      } catch (error) {
        // A published card already consumed the Await; do not re-enter after
        // an output-consumer failure just to perform an impossible cleanup.
        if (!inserted && current() && key !== undefined) {
          const target = key;
          await command('group-b.database-remove-await', () => ({
            key: target,
          }));
        }
        Telemetry.error(error, { surface: 'database.insert.failed' });
        toast.failure('The database could not be inserted. Try again.');
      }
    },
  };
}
