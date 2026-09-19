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
import { Dynamic } from 'solid-js/web';
import type { ActivityAction } from '../core/event';

const GLYPHS = {
  created: Plus,
  edited: PencilSimple,
  opened: Eye,
  deleted: Trash,
  messaged: ChatCircle,
  'email-sent': PaperPlaneTilt,
  'property-changed': SlidersHorizontal,
  'participant-added': UserPlus,
  'participant-removed': UserMinus,
  'call-started': Phone,
  unknown: PencilSimple,
} as const;

/** A small icon for the kind of action, for glyph-led activity rows. */
export function ActionGlyph(props: { action: ActivityAction; class?: string }) {
  return (
    <Dynamic
      component={GLYPHS[props.action.kind]}
      class={props.class ?? 'size-3'}
    />
  );
}
