import { scopeChannelNotificationsForEntity } from '@app/features/soup/entity-notifications';
import type { EntityData } from '@entity';
import { toNotificationEntity } from '@entity/utils/notification';
import type { NotificationEntityRef } from '@queries/notification/entity-mutations';
import { batch } from 'solid-js';
import {
  executeMarkEntitiesDone,
  executeMarkEntitiesUndone,
  type MarkDoneWriteOutcome,
} from '../utils';
import { applyGraphqlDoneOptimistic } from './graphql-done-optimism';

export type DoneEntityKey = `${EntityData['type']}:${string}`;

export function doneEntityKey(
  entity: Pick<EntityData, 'type' | 'id'>
): DoneEntityKey {
  return `${entity.type}:${entity.id}`;
}

type Receipt = {
  emailIds: string[];
  notificationIds: string[];
  reminderIds: string[];
};
type Attempt = {
  kind: MarkDoneWriteOutcome['kind'];
  id?: string;
  entity?: EntityData;
  knownNotificationIds: string[];
  rowIds: string[];
  state: 'pending' | 'done' | 'undone' | 'failed' | 'noop';
  displayDone: boolean;
  receipt?: Receipt;
  optimistic: ReturnType<typeof applyGraphqlDoneOptimistic>;
};

type Args = {
  entities: EntityData[];
  emailIds: string[];
  reminderIds: string[];
  notificationIds: string[];
  notificationIdsByEntity: ReadonlyMap<DoneEntityKey, string[]>;
  notificationEntities: NotificationEntityRef[];
  scopeChannelThreads: boolean;
};

/** Each independently persisted field owns its display intent and exact receipt. */
export function createGraphqlDoneOperation(args: Args) {
  const attempts: Attempt[] = [];
  const add = (
    kind: Attempt['kind'],
    rowIds: string[],
    notificationIds: string[],
    id?: string,
    entity?: EntityData
  ) => {
    attempts.push({
      kind,
      id,
      entity,
      knownNotificationIds: notificationIds,
      rowIds,
      state: 'pending',
      displayDone: true,
      optimistic: applyGraphqlDoneOptimistic({
        entityIds: rowIds,
        notificationIds,
        scopeChannelThreads: args.scopeChannelThreads,
      }),
    });
  };
  batch(() => {
    for (const id of args.emailIds) add('email', [id], [], id);
    for (const id of args.reminderIds) add('reminder', [id], [], id);
    const selectiveIds = new Set(args.notificationIds);
    const claimedIds = new Set<string>();
    for (const entity of args.entities) {
      const entityScoped = args.notificationEntities.some(
        (ref) => ref.type === entity.type && ref.id === entity.id
      );
      const notificationIds = (
        args.notificationIdsByEntity.get(doneEntityKey(entity)) ?? []
      ).filter((id) => {
        if (claimedIds.has(id) || (!entityScoped && !selectiveIds.has(id)))
          return false;
        claimedIds.add(id);
        return true;
      });
      if (!entityScoped && notificationIds.length === 0) continue;
      add(
        entityScoped ? 'entity-notifications' : 'notifications',
        entity.type === 'email' || entity.type === 'reminder'
          ? []
          : [entity.id],
        notificationIds,
        undefined,
        entity
      );
    }
  });

  const matches = (
    attempt: Attempt,
    outcome: MarkDoneWriteOutcome,
    replay = false
  ) => {
    if (outcome.kind === 'email' || outcome.kind === 'reminder')
      return attempt.kind === outcome.kind && attempt.id === outcome.id;
    return (
      attempt.kind === outcome.kind ||
      (replay &&
        outcome.kind === 'notifications' &&
        attempt.kind === 'entity-notifications')
    );
  };
  const hasAccepted = () =>
    attempts.some((attempt) => attempt.receipt !== undefined);
  const failInitial = (attempt: Attempt) => {
    attempt.optimistic.rollback();
    attempt.state = 'failed';
  };
  const apply = (attempt: Attempt, done: boolean) => {
    if (attempt.displayDone === done) return;
    if (done) attempt.optimistic.reapply();
    else attempt.optimistic.applyUndone();
    attempt.displayDone = done;
  };
  const observeInitial = (outcome: MarkDoneWriteOutcome) =>
    batch(() => {
      for (const attempt of attempts.filter((attempt) =>
        matches(attempt, outcome)
      )) {
        if (outcome.result.status === 'rejected') {
          failInitial(attempt);
          continue;
        }
        attempt.state = 'done';
        if (outcome.kind === 'email') {
          attempt.receipt = {
            emailIds: [outcome.id],
            notificationIds: [],
            reminderIds: [],
          };
        } else if (outcome.kind === 'reminder') {
          attempt.receipt = {
            emailIds: [],
            notificationIds: [],
            reminderIds: [outcome.id],
          };
        } else {
          let ids: string[];
          if (outcome.kind === 'notifications') {
            const requested = new Set(attempt.knownNotificationIds);
            ids = outcome.result.value.filter((id) => requested.has(id));
          } else {
            const entity = attempt.entity;
            const target = entity && toNotificationEntity(entity);
            let notifications = outcome.result.value.filter(
              (notification) =>
                notification.entity_id === target?.id &&
                notification.entity_type === target?.type
            );
            if (
              entity &&
              args.scopeChannelThreads &&
              (entity.type === 'channel' || entity.type === 'channel_thread')
            )
              notifications = scopeChannelNotificationsForEntity(
                entity,
                notifications
              );
            ids = notifications.map(({ id }) => id);
          }
          if (ids.length > 0) {
            attempt.receipt = {
              emailIds: [],
              notificationIds: ids,
              reminderIds: [],
            };
          } else {
            // No matching receipt justifies neither a hide nor a restoration.
            // Release this attempt even when Undo was never requested: a stale
            // reader might otherwise keep the row hidden indefinitely.
            attempt.state = 'noop';
            attempt.optimistic.rollback();
          }
        }
      }
    });

  const run = async (done: boolean) => {
    const selected = attempts.filter(
      (attempt) =>
        attempt.receipt && attempt.state === (done ? 'undone' : 'done')
    );
    batch(() => {
      for (const attempt of selected) apply(attempt, done);
    });
    if (selected.length === 0) return;
    const pending = new Set(selected);
    const fail = (attempt: Attempt) => {
      apply(attempt, !done);
      attempt.optimistic.releaseGraphql();
    };
    const onWriteSettled = (outcome: MarkDoneWriteOutcome) =>
      batch(() => {
        for (const attempt of selected.filter((attempt) =>
          matches(attempt, outcome, true)
        )) {
          pending.delete(attempt);
          if (outcome.result.status === 'rejected') fail(attempt);
          else {
            attempt.state = done ? 'done' : 'undone';
            attempt.optimistic.settle(attempt.receipt?.notificationIds);
          }
        }
      });
    const receipt = {
      emailIds: selected.flatMap((attempt) => attempt.receipt?.emailIds ?? []),
      notificationIds: [
        ...new Set(
          selected.flatMap((attempt) => attempt.receipt?.notificationIds ?? [])
        ),
      ],
      reminderIds: selected.flatMap(
        (attempt) => attempt.receipt?.reminderIds ?? []
      ),
      onWriteSettled,
    };
    try {
      if (done) await executeMarkEntitiesDone(receipt);
      else await executeMarkEntitiesUndone(receipt);
    } finally {
      // Failures before dispatch/reconciliation cannot leave guessed intent.
      // Already acknowledged siblings retain their new state and are skipped
      // when the user retries this Undo/Redo.
      batch(() => {
        for (const attempt of pending) fail(attempt);
      });
    }
  };

  return {
    hasAccepted,
    hasFailures: () => attempts.some(({ state }) => state === 'failed'),
    completedCount: () =>
      new Set(
        attempts
          .filter(({ state }) => state === 'done')
          .flatMap(({ rowIds }) => rowIds)
      ).size,
    execute: async () => {
      try {
        await executeMarkEntitiesDone({
          emailIds: args.emailIds,
          reminderIds: args.reminderIds,
          notificationIds: args.notificationIds,
          notificationEntities: args.notificationEntities,
          onWriteSettled: observeInitial,
        });
      } catch (error) {
        batch(() => {
          for (const attempt of attempts)
            if (attempt.state === 'pending') failInitial(attempt);
        });
        if (!hasAccepted()) throw error;
      }
    },
    undo: () => run(false),
    redo: () => run(true),
    applyUndone: () =>
      batch(() => {
        for (const attempt of attempts)
          if (
            attempt.state === 'pending' ||
            (attempt.state === 'done' && attempt.receipt)
          )
            apply(attempt, false);
      }),
    reapply: () =>
      batch(() => {
        for (const attempt of attempts)
          if (attempt.state === 'undone' && attempt.receipt)
            apply(attempt, true);
      }),
    settle: () =>
      batch(() => {
        for (const attempt of attempts)
          if (attempt.state === 'done' && attempt.displayDone)
            attempt.optimistic.settle(attempt.receipt?.notificationIds);
      }),
    rollback: () =>
      batch(() => {
        for (const attempt of attempts)
          if (attempt.state === 'pending') failInitial(attempt);
      }),
    releaseGraphql: () =>
      batch(() => {
        for (const attempt of attempts) attempt.optimistic.releaseGraphql();
      }),
  };
}
