import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { focusInput } from '@core/directive/focusInput';
import { hapticImpact } from '@core/mobile/haptics';
import SearchIcon from '@icon/macro-magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import { cn, Layer } from '@ui';
import { type Accessor, createEffect, Show } from 'solid-js';
import {
  MOBILE_FLOATING_BUTTON_TRANSITION,
  MOBILE_FLOATING_BUTTON_VISIBLE,
} from './soup-view-mobile-floating-motion';

false && focusInput;

export function SoupViewMobileSearchButton(props: {
  open: Accessor<boolean>;
  visible?: Accessor<boolean>;
  onOpen: () => void;
}) {
  const isVisible = () => !props.open();
  const isExpanded = () => props.visible?.() ?? true;

  return (
    <Layer depth={4}>
      <button
        type="button"
        use:focusInput={{
          getTarget: () => document.getElementById('soup-mobile-search-input'),
        }}
        class={cn(
          'absolute bottom-4 right-4 z-10 size-11 rounded-full',
          'bg-surface flex items-center justify-center shadow-md ring ring-edge',
          MOBILE_FLOATING_BUTTON_TRANSITION,
          !isVisible()
            ? 'pointer-events-none translate-y-2'
            : isExpanded()
              ? 'opacity-100 -translate-x-[calc(100%+5.25rem)] scale-100'
              : MOBILE_FLOATING_BUTTON_VISIBLE
        )}
        disabled={!isVisible()}
        aria-hidden={!isVisible()}
        aria-label="Search"
        onClick={() => {
          hapticImpact('light');
          props.onOpen();
        }}
      >
        <SearchIcon class="size-5" />
      </button>
    </Layer>
  );
}

export function SoupViewMobileSearchBar(props: {
  open: Accessor<boolean>;
  onClose: () => void;
}) {
  const { searchText, setSearchText, setSearchPaused } = useSoupView();
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (!props.open()) return;
    setSearchPaused(false);
    setTimeout(() => inputRef?.focus());
  });

  return (
    <Show when={props.open()}>
      <Layer depth={4}>
        <div
          class="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-surface px-2 border-t border-edge-muted"
          data-no-focus-restore
        >
          <button
            type="button"
            class="text-ink-muted flex flex-col items-center justify-center pl-2 pt-3 pb-2"
            onClick={() => {
              setSearchText('');
              props.onClose();
            }}
            title="Close Search"
          >
            <XIcon class="size-6" />
          </button>
          <input
            ref={inputRef}
            id="soup-mobile-search-input"
            type="text"
            class="pt-3 pb-2 flex-1 min-w-0 bg-transparent border-0 outline-none focus:outline-none ring-0 focus:ring-0 text-ink-muted placeholder:text-ink-placeholder"
            placeholder="Search..."
            value={searchText()}
            onInput={(e) => setSearchText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.currentTarget.blur();
              props.onClose();
            }}
          />
        </div>
      </Layer>
    </Show>
  );
}
