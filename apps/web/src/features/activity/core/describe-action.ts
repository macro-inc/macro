import { formatLength } from '@app/features/time-tracking/core/format-length';
import { match } from 'ts-pattern';
import { entryAction, entrySize, type FeedEntry } from './collapse-runs';
import type { ActivityAction } from './event';

type RecordMergedAction = Extract<ActivityAction, { kind: 'record-merged' }>;

/** "Old Co", "Old Co and Other", "Old Co, Other and 2 more". */
function mergedNames(action: RecordMergedAction): string {
  const names = action.merged.map((record) => record.name ?? 'a company');
  if (names.length === 0) return 'a company';
  if (names.length === 1) return names[0];
  if (names.length <= 3)
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

/**
 * How a feed entry reads: the action its line carries (a property run
 * collapses to its net change) and, for runs, the count suffix that follows
 * the entity ("5 times", "3 changes"). Singles carry no suffix.
 */
export function describeRun(entry: FeedEntry): {
  action: ActivityAction;
  countLabel: string | undefined;
} {
  const action = entryAction(entry);
  const size = entrySize(entry);
  if (size < 2) return { action, countLabel: undefined };
  return {
    action,
    countLabel: match(action.kind)
      .with('property-changed', () => `${size} changes`)
      .with('time-logged', () => `${size} entries`)
      .otherwise(() => `${size} times`),
  };
}

/**
 * Short verb phrase for one activity action, phrased to follow an actor
 * name: "Sarah <created this>". With a `count` of two or more the count is
 * folded into the phrase ("made 5 edits", "opened this 5 times") so a run
 * without a named entity never reads as "made an edit 5 times". Unknown
 * actions (rows written by a newer deployment) fall back to their humanized
 * raw tag rather than hiding the row.
 */
export function describeAction(action: ActivityAction, count = 1): string {
  if (count < 2) {
    return match(action)
      .with({ kind: 'task-added' }, () => 'added a task')
      .with({ kind: 'task-removed' }, () => 'removed a task')
      .with({ kind: 'created' }, () => 'created this')
      .with({ kind: 'edited' }, () => 'made an edit')
      .with({ kind: 'opened' }, () => 'opened this')
      .with({ kind: 'deleted' }, () => 'deleted this')
      .with({ kind: 'messaged' }, () => 'sent a message')
      .with({ kind: 'email-sent' }, () => 'sent an email')
      .with({ kind: 'property-changed' }, () => 'changed a property')
      .with({ kind: 'participant-added' }, () => 'added a participant')
      .with({ kind: 'participant-removed' }, () => 'removed a participant')
      .with({ kind: 'call-started' }, () => 'started a call')
      .with({ kind: 'responded' }, () => 'responded')
      .with(
        { kind: 'time-logged' },
        (logged) => `logged ${formatLength(logged.minutes)}`
      )
      .with(
        { kind: 'record-merged' },
        (merge) => `merged ${mergedNames(merge)} into this`
      )
      .with({ kind: 'unknown' }, (unknown) => unknown.tag.replaceAll('_', ' '))
      .exhaustive();
  }
  return match(action)
    .with({ kind: 'task-added' }, () => `added ${count} tasks`)
    .with({ kind: 'task-removed' }, () => `removed ${count} tasks`)
    .with({ kind: 'created' }, () => `created this ${count} times`)
    .with({ kind: 'edited' }, () => `made ${count} edits`)
    .with({ kind: 'opened' }, () => `opened this ${count} times`)
    .with({ kind: 'deleted' }, () => `deleted this ${count} times`)
    .with({ kind: 'messaged' }, () => `sent ${count} messages`)
    .with({ kind: 'email-sent' }, () => `sent ${count} emails`)
    .with({ kind: 'property-changed' }, () => `made ${count} property changes`)
    .with({ kind: 'participant-added' }, () => `added ${count} participants`)
    .with(
      { kind: 'participant-removed' },
      () => `removed ${count} participants`
    )
    .with({ kind: 'call-started' }, () => `started ${count} calls`)
    .with({ kind: 'responded' }, () => `responded ${count} times`)
    .with(
      { kind: 'time-logged' },
      (logged) => `logged ${formatLength(logged.minutes)} in ${count} entries`
    )
    .with({ kind: 'record-merged' }, () => `made ${count} merges`)
    .with(
      { kind: 'unknown' },
      (unknown) => `${unknown.tag.replaceAll('_', ' ')} ${count} times`
    )
    .exhaustive();
}

/**
 * The verb for a row that names its entity: "<actor> <verb> [connector]
 * <entity>". Direct-object actions carry no connector ("created *Doc*");
 * located actions carry the natural preposition ("sent a message *in*
 * #general", "changed Status *on* *Doc*").
 */
export function describeActionForEntity(action: ActivityAction): {
  verb: string;
  connector?: string;
} {
  return match(action)
    .with({ kind: 'task-added' }, () => ({
      verb: 'added a task',
      connector: 'to',
    }))
    .with({ kind: 'task-removed' }, () => ({
      verb: 'removed a task',
      connector: 'from',
    }))
    .with({ kind: 'created' }, () => ({
      verb: 'created',
    }))
    .with({ kind: 'edited' }, () => ({ verb: 'edited' }))
    .with({ kind: 'opened' }, () => ({ verb: 'opened' }))
    .with({ kind: 'deleted' }, () => ({
      verb: 'deleted',
    }))
    .with({ kind: 'messaged' }, () => ({
      verb: 'sent a message',
      connector: 'in',
    }))
    .with({ kind: 'email-sent' }, () => ({
      verb: 'sent an email',
      connector: 'in',
    }))
    .with({ kind: 'property-changed' }, () => ({
      verb: 'changed a property',
      connector: 'on',
    }))
    .with({ kind: 'participant-added' }, () => ({
      verb: 'added a participant',
      connector: 'to',
    }))
    .with({ kind: 'participant-removed' }, () => ({
      verb: 'removed a participant',
      connector: 'from',
    }))
    .with({ kind: 'call-started' }, () => ({
      verb: 'started a call',
      connector: 'in',
    }))
    .with({ kind: 'responded' }, () => ({ verb: 'responded', connector: 'to' }))
    .with({ kind: 'time-logged' }, (logged) => ({
      verb: `logged ${formatLength(logged.minutes)}`,
      connector: 'on',
    }))
    .with({ kind: 'record-merged' }, (merge) => ({
      verb: `merged ${mergedNames(merge)}`,
      connector: 'into',
    }))
    .with({ kind: 'unknown' }, (unknown) => ({
      verb: unknown.tag.replaceAll('_', ' '),
      connector: 'on',
    }))
    .exhaustive();
}
