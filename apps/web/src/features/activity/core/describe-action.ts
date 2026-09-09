import { match } from 'ts-pattern';
import { entryAction, entrySize, type FeedEntry } from './collapse-runs';
import type { ActivityAction } from './event';

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
    countLabel:
      action.kind === 'property-changed' ? `${size} changes` : `${size} times`,
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
      .with({ kind: 'unknown' }, (unknown) => unknown.tag.replaceAll('_', ' '))
      .exhaustive();
  }
  return match(action)
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
    .with({ kind: 'unknown' }, (unknown) => ({
      verb: unknown.tag.replaceAll('_', ' '),
      connector: 'on',
    }))
    .exhaustive();
}
