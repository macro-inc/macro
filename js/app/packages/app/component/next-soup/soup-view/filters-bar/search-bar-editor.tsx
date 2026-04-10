import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { markdownToPlainText } from '@macro-inc/lexical-core/utils/parsers';
import { createSignal, createEffect } from 'solid-js';
import { QUERY_FILTERS } from '@app/component/next-soup/filters/query-filters';
import { INDEX_OPTIONS as INDEX_OPTIONS_SOURCE } from './search-filter-controls';

interface SearchBarEditorProps {
  autoFocus?: boolean;
  onDismiss?: () => void;
  onFocusReady?: (fn: () => void) => void;
  onHasContentChange?: (has: boolean) => void;
}

export default function SearchBarEditor(props: SearchBarEditorProps) {
  const { setSearchText, setSearchPaused, soup, setQueryFilters } =
    useSoupView();

  const [latestMarkdown, setLatestMarkdown] = createSignal('');
  const [mentions, setMentions] = createSignal<string[]>([]);

  const syncMentionFilters = (mentionIds: string[]) => {
    const hasMentions = mentionIds.length > 0;
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
          mentions: mentionIds,
        },
      });
    } else {
      setQueryFilters((prev) => ({
        ...prev,
        channel_filters: {
          ...prev.channel_filters,
          mentions: mentionIds,
        },
      }));
    }
  };

  const editor = buildConfig('chat')
    .namespace('soup-search-bar')
    .singleLine()
    .withMentions({
      onCreate: (mention) => {
        if (mention.itemType !== 'user') return;
        const val = `user:${mention.itemId}`;
        setMentions((prev) => (prev.includes(val) ? prev : [...prev, val]));
      },
      onRemove: (mention) => {
        if (mention.itemType !== 'user') return;
        setMentions((prev) =>
          prev.filter((m) => m !== `user:${mention.itemId}`)
        );
      },
    })
    .onChange((markdown) => {
      setLatestMarkdown(markdown);
      props.onHasContentChange?.(markdown.trim().length > 0);
    })
    .onEscape(() => {
      props.onDismiss?.();
      return true;
    });

  createEffect(() => {
    const menuOpen =
      editor.buildHandle()._internal.mentionsMenuOps?.isOpen() ?? false;
    setSearchPaused(menuOpen);

    if (!menuOpen) {
      const plainText = markdownToPlainText(latestMarkdown()).trim();
      setSearchText(plainText);
      syncMentionFilters(mentions());
    }
  });

  props.onFocusReady?.(() => editor.controls.focus());

  return (
    <MarkdownShell
      config={editor}
      placeholder="Search"
      autofocus={props.autoFocus}
      class="!min-h-0 !overflow-visible"
    />
  );
}
