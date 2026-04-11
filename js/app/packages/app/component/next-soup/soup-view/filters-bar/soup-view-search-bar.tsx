import XIcon from '@icon/regular/x.svg?component-solid';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import { cn } from '@ui/utils/classname';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { Hotkey } from '@core/component/Hotkey';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { registerHotkey } from '@core/hotkey/hotkeys';
import {
  createSignal,
  lazy,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';

const LazySearchBarEditor = lazy(() => import('./search-bar-editor'));

type SearchbarVariant = 'filled' | 'secondary';

interface SoupSearchbarProps {
  variant?: SearchbarVariant;
  autoFocus?: boolean;
  onDismiss?: () => void;
}

const variantStyles: Record<SearchbarVariant, string> = {
  filled:
    'bg-ink/5 text-ink-muted hover:bg-ink/7 hover:text-ink border-transparent focus-within:bg-ink/7 focus-within:text-ink',
  secondary:
    'bg-transparent text-ink-muted border-edge-muted hover:bg-input hover:text-ink focus-within:bg-input focus-within:text-ink',
};

export const SoupSearchbar = (props: SoupSearchbarProps) => {
  const { searchText, setSearchText } = useSoupView();
  const panel = useSplitPanelOrThrow();

  const [activated, setActivated] = createSignal(false);
  const [hasContent, setHasContent] = createSignal(false);

  let plainInputRef: HTMLInputElement | undefined;
  let editorFocus: (() => void) | undefined;

  const searchHotkey = registerHotkey({
    hotkey: ['cmd+f'],
    scopeId: panel.splitHotkeyScope,
    description: 'Search',
    keyDownHandler: () => {
      if (activated()) {
        editorFocus?.();
      } else {
        plainInputRef?.focus();
      }
      return true;
    },
  });

  onCleanup(searchHotkey.dispose);

  return (
    <div
      class="w-full flex items-center shrink-0 grow min-w-0 mobile:-order-2"
      data-search-bar-wrapper
    >
      <Tooltip
        class="w-full"
        placement="bottom-start"
        tooltip={<LabelAndHotKey label="Search" shortcut="⌘F" />}
      >
        <div
          class={cn(
            'relative flex items-center gap-1 rounded-xs py-1.5 mobile:h-9 pl-2 pr-1 mobile:min-w-35 border text-xs',
            variantStyles[props.variant ?? 'secondary']
          )}
        >
          <SearchIcon class="size-4 shrink-0" />
          <Show
            when={activated()}
            fallback={
              <input
                ref={plainInputRef}
                data-soup-search
                type="text"
                value={searchText()}
                onFocus={() => setActivated(true)}
                onInput={(e) => {
                  setSearchText(e.currentTarget.value);
                  setHasContent(e.currentTarget.value.length > 0);
                }}
                placeholder="Search"
                class="peer p-0 bg-transparent border-none outline-none ring-0 focus:outline-none focus:ring-0 cursor-default w-full text-sm"
              />
            }
          >
            <div class="flex-1 min-w-0">
              <Suspense>
                <LazySearchBarEditor
                  initialValue={searchText()}
                  onDismiss={props.onDismiss}
                  onFocusReady={(fn) => {
                    editorFocus = fn;
                  }}
                  onHasContentChange={setHasContent}
                />
              </Suspense>
            </div>
          </Show>
          <Show when={!hasContent() && !activated() && !props.onDismiss}>
            <div class="absolute -right-2 top-1/2 -translate-1/2 flex border border-edge-muted text-xs rounded-md items-center px-1 py-px">
              <Hotkey shortcut="cmd+f" />
            </div>
          </Show>
          <Show when={hasContent() || props.onDismiss}>
            <button
              type="button"
              class="ml-auto size-4 mobile:size-6 shrink-0 hover:opacity-60"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSearchText('');
                setHasContent(false);
                setActivated(false);
                props.onDismiss?.();
              }}
            >
              <XIcon class="size-4 mobile:size-6" />
            </button>
          </Show>
        </div>
      </Tooltip>
    </div>
  );
};
