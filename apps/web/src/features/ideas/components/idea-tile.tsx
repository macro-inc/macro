import ArrowBendUpLeftIcon from '@icon/system/regular/arrow-bend-up-left.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import type { Component } from 'solid-js';
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
      icon: ArrowBendUpLeftIcon,
      color: 'text-email',
    }))
    .with({ kind: 'entity', action: 'review' }, () => ({
      icon: FileTextIcon,
      color: 'text-success',
    }))
    .with({ kind: 'entity', action: 'follow_up' }, () => ({
      icon: ClockIcon,
      color: 'text-task',
    }))
    .with({ kind: 'routine' }, () => ({
      icon: RepeatIcon,
      color: 'text-warning',
    }))
    .exhaustive();
}

/** The routine step tile, for an idea: a quiet square with the kind's glyph. */
export function IdeaTile(props: { idea: Idea }) {
  const look = () => ideaLook(props.idea);

  return (
    <span
      class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink/5"
      aria-hidden="true"
    >
      <Dynamic component={look().icon} class={`size-4 ${look().color}`} />
    </span>
  );
}
