import ChatCircle from '@icon/system/regular/chat-circle.svg';
import ClipboardText from '@icon/system/regular/clipboard-text.svg';
import Eye from '@icon/system/regular/eye.svg';
import Minus from '@icon/system/regular/minus.svg';
import PaperPlaneTilt from '@icon/system/regular/paper-plane-tilt.svg';
import PencilSimple from '@icon/system/regular/pencil-simple.svg';
import Phone from '@icon/system/regular/phone.svg';
import Plus from '@icon/system/regular/plus.svg';
import SlidersHorizontal from '@icon/system/regular/sliders-horizontal.svg';
import Trash from '@icon/system/regular/trash.svg';
import UserMinus from '@icon/system/regular/user-minus.svg';
import UserPlus from '@icon/system/regular/user-plus.svg';
import { Dynamic } from 'solid-js/web';
import type { ActivityAction } from '../core/event';

const GLYPHS = {
  created: Plus,
  'task-added': Plus,
  'task-removed': Minus,
  edited: PencilSimple,
  opened: Eye,
  deleted: Trash,
  messaged: ChatCircle,
  'email-sent': PaperPlaneTilt,
  'property-changed': SlidersHorizontal,
  'participant-added': UserPlus,
  'participant-removed': UserMinus,
  'call-started': Phone,
  responded: ClipboardText,
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
