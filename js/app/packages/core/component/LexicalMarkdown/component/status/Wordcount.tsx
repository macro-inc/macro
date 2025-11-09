import { IconButton } from '@core/component/IconButton';
import CaretUp from '@icon/regular/caret-up.svg';
import Stats from '@icon/regular/chart-bar.svg';
import { Popover } from '@kobalte/core/popover';
import { createSignal, Show } from 'solid-js';
import type { Store } from 'solid-js/store';
import type { WordcountStats } from '../../plugins';

export function Wordcount(props: { stats: Store<WordcountStats> }) {
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);

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

  return (
    <Popover placement="top-start" open={menuOpen()} onOpenChange={setMenuOpen}>
      <div
        class="relative flex w-fit gap-1 items-center p-1"
        classList={{ 'bg-active': menuOpen() }}
      >
        <Popover.Anchor>
          <IconButton
            icon={() => <Stats class=" size-5 opacity-50" />}
            tooltip={{ label: 'Wordcount' }}
            theme="clear"
            onClick={toggleExpanded}
          />
        </Popover.Anchor>

        <Show when={isExpanded()}>
          <Popover.Trigger class="dropdown-menu__trigger">
            <div class="text-sm text-ink-extra-muted flex w-32 justify-between h-7 rounded items-center hover:bg-hover hover-transition-bg p-1">
              <span>
                <span class="font-semibold">
                  {simpleWordCount().toLocaleString()}
                </span>{' '}
                {simpleWordCount() === 1 ? 'word' : 'words'}
              </span>
              <CaretUp class="text-ink-extra-muted size-3" />
            </div>
          </Popover.Trigger>
        </Show>
        <Popover.Portal>
          <Popover.Content>
            <div class="p-3 text rounded shadow-md ring-1 ring-edge w-64 bg-dialog text-ink text-sm">
              <div class="flex justify-between mb-1">
                <span>Words</span>
                <span>{Words()}</span>
              </div>
              <div class="flex justify-between">
                <span>Characters</span>
                <span>{Chars()}</span>
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover>
  );
}
