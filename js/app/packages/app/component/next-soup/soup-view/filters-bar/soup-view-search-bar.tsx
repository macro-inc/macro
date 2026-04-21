import XIcon from '@icon/regular/x.svg?component-solid';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import { cn } from '@ui/utils/classname';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { Hotkey } from '@core/component/Hotkey';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { markdownToPlainText } from '@macro-inc/lexical-core/utils/parsers';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { createSignal, createEffect, on, onCleanup, Show } from 'solid-js';

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
  const { setSearchText, setSearchPaused, setSearchMentions } = useSoupView();
  const panel = useSplitPanelOrThrow();

  const [hasContent, setHasContent] = createSignal(false);
  const [latestMarkdown, setLatestMarkdown] = createSignal('');
  const [mentions, setMentions] = createSignal<string[]>([]);

  const editor = buildConfig('chat')
    .namespace('soup-search-bar')
    .singleLine()
    .withMentions({
      sources: ['users'],
      disableMentionTracking: true,
      onCreate: (mention) => {
        if (mention.itemType !== 'user') return;
        setMentions((prev) =>
          prev.includes(mention.itemId) ? prev : [...prev, mention.itemId]
        );
      },
      onRemove: (mention) => {
        if (mention.itemType !== 'user') return;
        setMentions((prev) => prev.filter((m) => m !== mention.itemId));
      },
    })
    .withHistory({ timeGap: 400 })
    .onChange((markdown) => {
      setLatestMarkdown(markdown);
      setHasContent(markdown.trim().length > 0);
    })
    .onEnter(() => {
      if (menuIsOpen()) return false;
      editor.controls.blur();
      return true;
    })
    .onEscape(() => {
      editor.controls.blur();
      props.onDismiss?.();
      return true;
    })
    .onTab((e) => {
      e.preventDefault();
      return true;
    });

  // Sync search text + mention filters only when the mention menu is closed.
  // This avoids cascading reactive updates during mention insertion and
  // prevents search from firing while typing @partial.
  const menuIsOpen = () => editor.controls.isMentionMenuOpen();

  createEffect(() => setSearchPaused(menuIsOpen()));

  createEffect(
    on(latestMarkdown, (markdown) => {
      if (menuIsOpen()) return;
      setSearchText(markdownToPlainText(markdown).trim());
    })
  );

  createEffect(() => setSearchMentions(mentions()));

  const searchHotkey = registerHotkey({
    hotkey: ['cmd+f'],
    scopeId: panel.splitHotkeyScope,
    registrationType: 'add',
    description: 'Search',
    keyDownHandler: () => {
      editor.controls.focus();
      return true;
    },
  });

  onCleanup(searchHotkey.dispose);

  return (
    <div
      class="w-full flex items-center shrink-0 grow min-w-0 mobile:-order-2"
      data-search-bar-wrapper
    >
      <div
        class={cn(
          'w-full relative flex items-center gap-1 rounded-xs py-1.5 mobile:h-9 pl-2 pr-1 mobile:min-w-35 border text-xs',
          variantStyles[props.variant ?? 'secondary']
        )}
      >
        <SearchIcon class="size-4 shrink-0" />
        <div
          data-soup-search
          class="flex-1 min-w-0 [&_[contenteditable]]:outline-none [&_[contenteditable]]:p-0 [&_p]:my-0"
          onKeyDown={(e) => {
            if (menuIsOpen()) return;
            if (e.key === 'ArrowDown' || e.key === 'j') {
              e.preventDefault();
              editor.controls.blur();
            }
          }}
        >
          <MarkdownShell
            config={editor}
            placeholder="Search, @mention contacts"
            autofocus={props.autoFocus}
            class="!min-h-0 !overflow-visible"
          />
        </div>
        <Show when={!hasContent() && !props.onDismiss}>
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
              editor.controls.clear();
              setSearchText('');
              setHasContent(false);
              setMentions([]);
              setSearchMentions([]);
              props.onDismiss?.();
            }}
          >
            <XIcon class="size-4 mobile:size-6" />
          </button>
        </Show>
      </div>
    </div>
  );
};
