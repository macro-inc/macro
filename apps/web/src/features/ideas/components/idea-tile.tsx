import ArrowBendUpLeftIcon from '@icon/system/regular/arrow-bend-up-left.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import PaperPlaneIcon from '@icon/system/regular/paper-plane-tilt.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import { Spinner } from '@ui';
import type { Component } from 'solid-js';
import { Match, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { Idea, IdeaStatus } from '../core/idea';

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

/** An idea's glyph: its kind while it waits, then where it stands. */
export function IdeaGlyph(props: { idea: Idea; status: IdeaStatus }) {
  const look = () => ideaLook(props.idea);

  return (
    <Switch
      fallback={
        <Dynamic component={look().icon} class={`size-4 ${look().color}`} />
      }
    >
      <Match when={props.status === 'running'}>
        <Spinner size="sm" decorative class="size-4" />
      </Match>
      <Match when={props.status === 'failed'}>
        <WarningIcon class="size-4 text-failure" />
      </Match>
      <Match when={props.status === 'done'}>
        <CheckIcon class="size-4 text-success" />
      </Match>
    </Switch>
  );
}
