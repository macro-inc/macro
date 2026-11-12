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
import type { Suggestion } from '../core/suggestion';

type Look = { icon: Component<{ class?: string }>; tint: string };

/**
 * Each kind's glyph in its own colour, from the tints the routine cards give
 * the parts of the app, so the kinds can be told apart at a glance.
 */
function suggestionLook(suggestion: Suggestion): Look {
  return match(suggestion)
    .returnType<Look>()
    .with({ kind: 'prompt', runMode: 'composer' }, () => ({
      icon: SparkleIcon,
      tint: 'text-purple',
    }))
    .with({ kind: 'prompt', runMode: 'background' }, (prompt) =>
      prompt.sends
        ? { icon: PaperPlaneIcon, tint: 'text-yellow' }
        : { icon: SparkleIcon, tint: 'text-accent' }
    )
    .with({ kind: 'entity', action: 'reply' }, () => ({
      icon: EnvelopeIcon,
      tint: 'text-blue',
    }))
    .with({ kind: 'entity', action: 'review' }, () => ({
      icon: FileTextIcon,
      tint: 'text-cyan',
    }))
    .with({ kind: 'entity', action: 'follow_up' }, () => ({
      icon: ArrowBendUpLeftIcon,
      tint: 'text-green',
    }))
    .with({ kind: 'routine' }, () => ({
      icon: ClockIcon,
      tint: 'text-orange',
    }))
    .exhaustive();
}

/**
 * A suggestion's tile: the kind's glyph on the app's item media square, or a check
 * once the suggestion is a finished row.
 */
export function SuggestionTile(props: {
  suggestion: Suggestion;
  finished?: boolean;
}) {
  const look = () => suggestionLook(props.suggestion);

  return (
    <Item.Media class="size-7 self-start" aria-hidden="true">
      <Show when={!props.finished} fallback={<CheckIcon class="size-4" />}>
        <Dynamic component={look().icon} class={`size-4 ${look().tint}`} />
      </Show>
    </Item.Media>
  );
}
