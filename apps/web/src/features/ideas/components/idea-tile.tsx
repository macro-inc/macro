import ArrowBendUpLeftIcon from '@icon/system/regular/arrow-bend-up-left.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Item } from '@ui';
import { type Component, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { Idea } from '../core/idea';

type Look = { icon: Component<{ class?: string }>; color: string };

function ideaLook(idea: Idea): Look {
  return match(idea)
    .with({ kind: 'prompt', runMode: 'composer' }, () => ({
      icon: SparkleIcon,
      color: 'text-accent',
    }))
    .with({ kind: 'prompt', runMode: 'background' }, (prompt) => ({
      icon: prompt.sends ? PaperPlaneIcon : SparkleIcon,
      color: prompt.sends ? 'text-warning' : 'text-accent',
    }))
    .with({ kind: 'entity', action: 'reply' }, () => ({
      icon: EnvelopeIcon,
      color: 'text-email',
    }))
    .with({ kind: 'entity', action: 'review' }, () => ({
      icon: FileTextIcon,
      color: 'text-success',
    }))
    .with({ kind: 'entity', action: 'follow_up' }, () => ({
      icon: ArrowBendUpLeftIcon,
      color: 'text-task',
    }))
    .with({ kind: 'routine' }, () => ({
      icon: ClockIcon,
      color: 'text-warning',
    }))
    .exhaustive();
}

/**
 * An idea's tile: the kind's glyph on the app's item media square, or a check
 * once the idea is a finished row.
 */
export function IdeaTile(props: { idea: Idea; finished?: boolean }) {
  const look = () => ideaLook(props.idea);

  return (
    <Item.Media class="size-7 self-start" aria-hidden="true">
      <Show
        when={!props.finished}
        fallback={<CheckIcon class="size-4 text-success" />}
      >
        <Dynamic component={look().icon} class={`size-4 ${look().color}`} />
      </Show>
    </Item.Media>
  );
}
