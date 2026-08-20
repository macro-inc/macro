import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { match } from 'ts-pattern';

type ActivityAction = ActivityEvent['action'];

/**
 * Narrows an action to its property-change member, for rows that render
 * the richer "changed X from A to B" phrase instead of [`describeAction`].
 */
export function actionAsPropertyChange(
  action: ActivityAction
):
  | Extract<ActivityAction, { __typename: 'GraphqlActivityPropertyChanged' }>
  | undefined {
  return action.__typename === 'GraphqlActivityPropertyChanged'
    ? action
    : undefined;
}

/**
 * Short verb phrase for one activity action, phrased to follow an actor
 * name: "Sarah <created this>". Unknown actions (rows written by a newer
 * deployment) fall back to their humanized raw tag rather than hiding the
 * row.
 */
export function describeAction(action: ActivityAction): string {
  return match(action)
    .with({ __typename: 'GraphqlActivityCreated' }, () => 'created this')
    .with({ __typename: 'GraphqlActivityEdited' }, () => 'made an edit')
    .with({ __typename: 'GraphqlActivityOpened' }, () => 'opened this')
    .with({ __typename: 'GraphqlActivityDeleted' }, () => 'deleted this')
    .with({ __typename: 'GraphqlActivityMessaged' }, () => 'sent a message')
    .with({ __typename: 'GraphqlActivitySent' }, () => 'sent an email')
    .with(
      { __typename: 'GraphqlActivityPropertyChanged' },
      () => 'changed a property'
    )
    .with(
      { __typename: 'GraphqlActivityParticipantAdded' },
      () => 'added a participant'
    )
    .with(
      { __typename: 'GraphqlActivityParticipantRemoved' },
      () => 'removed a participant'
    )
    .with({ __typename: 'GraphqlActivityCallStarted' }, () => 'started a call')
    .with({ __typename: 'GraphqlActivityUnknownAction' }, (unknown) =>
      unknown.tag.replaceAll('_', ' ')
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
  return (
    match(action)
      .with({ __typename: 'GraphqlActivityCreated' }, () => ({
        verb: 'created',
      }))
      .with({ __typename: 'GraphqlActivityEdited' }, () => ({ verb: 'edited' }))
      .with({ __typename: 'GraphqlActivityOpened' }, () => ({ verb: 'opened' }))
      .with({ __typename: 'GraphqlActivityDeleted' }, () => ({
        verb: 'deleted',
      }))
      .with({ __typename: 'GraphqlActivityMessaged' }, () => ({
        verb: 'sent a message',
        connector: 'in',
      }))
      .with({ __typename: 'GraphqlActivitySent' }, () => ({
        verb: 'sent an email',
        connector: 'in',
      }))
      // The caller renders the full transition phrase; only the connector
      // is needed for property changes.
      .with({ __typename: 'GraphqlActivityPropertyChanged' }, () => ({
        verb: 'changed a property',
        connector: 'on',
      }))
      .with({ __typename: 'GraphqlActivityParticipantAdded' }, () => ({
        verb: 'added a participant',
        connector: 'to',
      }))
      .with({ __typename: 'GraphqlActivityParticipantRemoved' }, () => ({
        verb: 'removed a participant',
        connector: 'from',
      }))
      .with({ __typename: 'GraphqlActivityCallStarted' }, () => ({
        verb: 'started a call',
        connector: 'in',
      }))
      .with({ __typename: 'GraphqlActivityUnknownAction' }, (unknown) => ({
        verb: unknown.tag.replaceAll('_', ' '),
        connector: 'on',
      }))
      .exhaustive()
  );
}
