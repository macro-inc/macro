import { match } from 'ts-pattern';
import type { ActivityAction } from './event';

/**
 * Short verb phrase for one activity action, phrased to follow an actor
 * name: "Sarah <created this>". Unknown actions (rows written by a newer
 * deployment) fall back to their humanized raw tag rather than hiding the
 * row.
 */
export function describeAction(action: ActivityAction): string {
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
