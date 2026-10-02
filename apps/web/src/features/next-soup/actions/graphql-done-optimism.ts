import { setDoneOverride } from '@notifications';
import { hideGraphqlSoupEntitiesAsDone } from '@queries/soup/graphql/optimistic-done';
import { batch } from 'solid-js';

/** GraphQL display intent never reads or patches the legacy REST caches. */
export function applyGraphqlDoneOptimistic(args: {
  entityIds: string[];
  notificationIds: string[];
  scopeChannelThreads?: boolean;
  done?: boolean;
}) {
  return batch(() => {
    const { done = true, ...intentArgs } = args;
    const intent =
      args.entityIds.length > 0
        ? hideGraphqlSoupEntitiesAsDone({ ...intentArgs, done })
        : undefined;
    let rollbackNotifications = setDoneOverride(args.notificationIds, done);

    const apply = (done: boolean) =>
      batch(() => {
        intent?.setDone(done);
        rollbackNotifications = setDoneOverride(args.notificationIds, done);
      });

    return {
      rollback: () =>
        batch(() => {
          intent?.release();
          rollbackNotifications();
        }),
      reapply: () => apply(true),
      // The query-local projection retains admitted rows/notification witnesses
      // for Undo; it does not need a snapshot of the REST notification feed.
      applyUndone: () => apply(false),
      settle: (notificationIds?: readonly string[]) =>
        intent?.settle(notificationIds),
      releaseGraphql: () =>
        batch(() => {
          intent?.release();
          rollbackNotifications.release();
        }),
    };
  });
}
