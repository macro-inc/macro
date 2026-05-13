import CaretUp from '@icon/regular/caret-up.svg';
import Stats from '@icon/regular/chart-bar.svg';
import { Button, HoverCard } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { Store } from 'solid-js/store';
import type { WordcountStats } from '../../plugins';

export function Wordcount(props: { stats: Store<WordcountStats> }) {
  const [isExpanded, setIsExpanded] = createSignal(false);

  const simpleWordCount = () => {
    if (props.stats.selectedWords === null) return props.stats.totalWords;
    return props.stats.selectedWords;
  };

  const Words = () => {
    if (props.stats.selectedWords === null)
      return <span>{props.stats.totalWords.toLocaleString()}</span>;
    return (
      <>
        <span>{props.stats.selectedWords.toLocaleString()}</span>
        <span class="opacity-50">
          {' '}
          / {props.stats.totalWords.toLocaleString()}
        </span>
      </>
    );
  };
  const Chars = () => {
    if (props.stats.selectedCharacters === null)
      return <span>{props.stats.totalCharacters.toLocaleString()}</span>;
    return (
      <>
        <span>{props.stats.selectedCharacters.toLocaleString()}</span>
        <span class="opacity-50">
          {' '}
          / {props.stats.totalCharacters.toLocaleString()}
        </span>
      </>
    );
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded());
  };

  const Details = () => (
    <div class="w-64 text-sm">
      <div class="flex justify-between mb-1">
        <span>Words</span>
        <span>{Words()}</span>
      </div>
      <div class="flex justify-between">
        <span>Characters</span>
        <span>{Chars()}</span>
      </div>
    </div>
  );

  return (
    <div class="relative flex w-fit gap-1 items-center p-1">
      <Button
        variant="ghost"
        size="icon-md"
        label="Wordcount"
        onClick={toggleExpanded}
      >
        <Stats class=" size-5 opacity-50" />
      </Button>

      <Show when={isExpanded()}>
        <HoverCard placement="top-start">
          <HoverCard.Trigger>
            <div class="text-sm text-ink-extra-muted flex w-32 justify-between h-7 rounded items-center hover:bg-hover hover-transition-bg p-1">
              <span>
                <span class="font-semibold">
                  {simpleWordCount().toLocaleString()}
                </span>{' '}
                {simpleWordCount() === 1 ? 'word' : 'words'}
              </span>
              <CaretUp class="text-ink-extra-muted size-3" />
            </div>
          </HoverCard.Trigger>
          <HoverCard.Content>
            <Details />
          </HoverCard.Content>
        </HoverCard>
      </Show>
    </div>
  );
}
