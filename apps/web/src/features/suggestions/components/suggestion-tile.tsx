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

type Look = { icon: Component<{ class?: string }> };

function suggestionLook(suggestion: Suggestion): Look {
  return match(suggestion)
    .with({ kind: 'prompt', runMode: 'composer' }, () => ({
      icon: SparkleIcon,
    }))
    .with({ kind: 'prompt', runMode: 'background' }, (prompt) => ({
      icon: prompt.sends ? PaperPlaneIcon : SparkleIcon,
    }))
    .with({ kind: 'entity', action: 'reply' }, () => ({
      icon: EnvelopeIcon,
    }))
    .with({ kind: 'entity', action: 'review' }, () => ({
      icon: FileTextIcon,
    }))
    .with({ kind: 'entity', action: 'follow_up' }, () => ({
      icon: ArrowBendUpLeftIcon,
    }))
    .with({ kind: 'routine' }, () => ({
      icon: ClockIcon,
    }))
    .exhaustive();
}

/**
 * An suggestion's tile: the kind's glyph on the app's item media square, or a check
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
        <Dynamic component={look().icon} class="size-4" />
      </Show>
    </Item.Media>
  );
}
