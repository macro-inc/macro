import Eye from '@lucide/eye.svg';
import ChatCircle from '@lucide/message-circle.svg';
import PencilSimple from '@lucide/pencil.svg';
import Phone from '@lucide/phone.svg';
import Plus from '@lucide/plus.svg';
import PaperPlaneTilt from '@lucide/send.svg';
import SlidersHorizontal from '@lucide/sliders-horizontal.svg';
import Trash from '@lucide/trash.svg';
import UserMinus from '@lucide/user-minus.svg';
import UserPlus from '@lucide/user-plus.svg';
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

/** A small icon for the kind of action, for glyph-led activity rows. */
export function ActionGlyph(props: {
  action: ActivityEvent['action'];
  class?: string;
}) {
  return (
    <Dynamic
      component={GLYPHS[props.action.__typename]}
      class={props.class ?? 'size-3'}
    />
  );
}
