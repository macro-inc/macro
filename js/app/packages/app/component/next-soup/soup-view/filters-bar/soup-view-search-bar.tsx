import XIcon from '@icon/regular/x.svg?component-solid';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import { cn } from '@ui/utils/classname';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { Hotkey } from '@core/component/Hotkey';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { markdownToPlainText } from '@macro-inc/lexical-core/utils/parsers';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { createSignal, onCleanup, Show } from 'solid-js';
import { QUERY_FILTERS } from '@app/component/next-soup/filters/query-filters';
import { INDEX_OPTIONS as INDEX_OPTIONS_SOURCE } from './search-filter-controls';

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

const USER_MENTION_RE = /<m-user-mention>(.*?)<\/m-user-mention>/g;

function extractUserMentionIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const match of markdown.matchAll(USER_MENTION_RE)) {
    try {
      const data = JSON.parse(match[1]);
      if (data.userId) ids.push(`user:${data.userId}`);
    } catch {
      // skip malformed
    }
  }
  return ids;
}

export const SoupSearchbar = (props: SoupSearchbarProps) => {
  const { searchText, setSearchText, soup, setQueryFilters } = useSoupView();
  const panel = useSplitPanelOrThrow();

  const [hasContent, setHasContent] = createSignal(false);

  const syncMentionFilters = (mentions: string[]) => {
    const hasMentions = mentions.length > 0;
    if (hasMentions && !soup.filters.isActive('channels')) {
      for (const opt of INDEX_OPTIONS_SOURCE) {
        if (soup.filters.isActive(opt.value)) {
          soup.filters.toggle({ or: [opt.value] });
        }
      }
      soup.filters.toggle({ or: ['channels'] });
      setQueryFilters({
        ...QUERY_FILTERS.channels,
        channel_filters: {
          ...QUERY_FILTERS.channels.channel_filters,
          mentions,
        },
      });
    } else {
      setQueryFilters((prev) => ({
        ...prev,
        channel_filters: {
          ...prev.channel_filters,
          mentions,
        },
      }));
    }
  };

  const editor = buildConfig('chat')
    .namespace('soup-search-bar')
    .singleLine()
    .withMentions()
    .onChange((markdown) => {
      const plainText = markdownToPlainText(markdown)
        .replace(/(^|\s)@\S*/g, '$1')
        .trim();
      setSearchText(plainText);
      setHasContent(markdown.trim().length > 0);

      const mentions = extractUserMentionIds(markdown);
      syncMentionFilters(mentions);
    })
    .onEscape(() => {
      props.onDismiss?.();
      return true;
    });

  const searchHotkey = registerHotkey({
    hotkey: ['cmd+f'],
    scopeId: panel.splitHotkeyScope,
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
          <div class="flex-1 min-w-0 [&_[contenteditable]]:outline-none [&_[contenteditable]]:p-0 [&_p]:my-0">
            <MarkdownShell
              config={editor}
              placeholder="Search"
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
