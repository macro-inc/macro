import type { ActivityEvent } from '@queries/activity/graphql/entity';

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
  switch (action.__typename) {
    case 'GraphqlActivityCreated':
      return 'created this';
    case 'GraphqlActivityEdited':
      return 'made an edit';
    case 'GraphqlActivityOpened':
      return 'opened this';
    case 'GraphqlActivityDeleted':
      return 'deleted this';
    case 'GraphqlActivityMessaged':
      return 'sent a message';
    case 'GraphqlActivitySent':
      return 'sent an email';
    case 'GraphqlActivityPropertyChanged':
      return 'changed a property';
    case 'GraphqlActivityParticipantAdded':
      return 'added a participant';
    case 'GraphqlActivityParticipantRemoved':
      return 'removed a participant';
    case 'GraphqlActivityCallStarted':
      return 'started a call';
    case 'GraphqlActivityUnknownAction':
      return action.tag.replaceAll('_', ' ');
    default:
      return assertNever(action);
  }
}

/** Compile-time exhaustiveness: a new action member fails typecheck here. */
function assertNever(action: never): string {
  console.warn('Unhandled activity action', action);
  return 'did something';
}
