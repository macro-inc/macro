import ChatCircle from '@phosphor/chat-circle.svg';
import Eye from '@phosphor/eye.svg';
import PaperPlaneTilt from '@phosphor/paper-plane-tilt.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Phone from '@phosphor/phone.svg';
import Plus from '@phosphor/plus.svg';
import SlidersHorizontal from '@phosphor/sliders-horizontal.svg';
import Trash from '@phosphor/trash.svg';
import UserMinus from '@phosphor/user-minus.svg';
import UserPlus from '@phosphor/user-plus.svg';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { Dynamic } from 'solid-js/web';

const GLYPHS = {
  GraphqlActivityCreated: Plus,
  GraphqlActivityEdited: PencilSimple,
  GraphqlActivityOpened: Eye,
  GraphqlActivityDeleted: Trash,
  GraphqlActivityMessaged: ChatCircle,
  GraphqlActivitySent: PaperPlaneTilt,
  GraphqlActivityPropertyChanged: SlidersHorizontal,
  GraphqlActivityParticipantAdded: UserPlus,
  GraphqlActivityParticipantRemoved: UserMinus,
  GraphqlActivityCallStarted: Phone,
  GraphqlActivityUnknownAction: PencilSimple,
} as const;

type ActivityActionType = ActivityEvent['action']['__typename'];

/** A small icon for an activity action typename. */
export function ActionTypeGlyph(props: {
  actionType: ActivityActionType;
  class?: string;
}) {
  return (
    <Dynamic
      component={GLYPHS[props.actionType]}
      class={props.class ?? 'size-3'}
    />
  );
}

/** A small icon for the kind of action, for glyph-led activity rows. */
export function ActionGlyph(props: {
  action: ActivityEvent['action'];
  class?: string;
}) {
  return (
    <ActionTypeGlyph
      actionType={props.action.__typename}
      class={props.class}
    />
  );
}
