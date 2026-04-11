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
  onCleanup,
  Show,
} from 'solid-js';

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

  const [editorReady, setEditorReady] = createSignal(false);
  const [hasContent, setHasContent] = createSignal(false);
  const [EditorComponent, setEditorComponent] = createSignal<
    typeof import('./search-bar-editor').default | null
  >(null);

  let plainInputRef: HTMLInputElement | undefined;
  let editorFocus: (() => void) | undefined;
  let loadStarted = false;

  const startEditorLoad = () => {
    if (loadStarted) return;
    loadStarted = true;
    import('./search-bar-editor').then((mod) => {
      setEditorComponent(() => mod.default);
    });
  };

  const searchHotkey = registerHotkey({
    hotkey: ['cmd+f'],
    scopeId: panel.splitHotkeyScope,
    description: 'Search',
    keyDownHandler: () => {
      if (editorReady()) {
        editorFocus?.();
      } else {
        plainInputRef?.focus();
      }
      return true;
    },
  });

  onCleanup(searchHotkey.dispose);

  const Editor = EditorComponent();

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
          <input
            ref={plainInputRef}
            data-soup-search
            type="text"
            value={searchText()}
            onFocus={startEditorLoad}
            onInput={(e) => {
              setSearchText(e.currentTarget.value);
              setHasContent(e.currentTarget.value.length > 0);
              startEditorLoad();
            }}
            placeholder="Search"
            class="peer p-0 bg-transparent border-none outline-none ring-0 focus:outline-none focus:ring-0 cursor-default w-full text-sm"
            classList={{ hidden: editorReady() }}
          />
          <Show when={EditorComponent()}>
            {(Comp) => (
              <div class="flex-1 min-w-0">
                {(() => {
                  const C = Comp();
                  return (
                    <C
                      initialValue={searchText()}
                      onDismiss={props.onDismiss}
                      onFocusReady={(fn) => {
                        editorFocus = fn;
                        // Transfer focus from plain input to editor
                        setEditorReady(true);
                        queueMicrotask(() => fn());
                      }}
                      onHasContentChange={setHasContent}
                    />
                  );
                })()}
              </div>
            )}
          </Show>
          <Show when={!hasContent() && !editorReady() && !props.onDismiss}>
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
