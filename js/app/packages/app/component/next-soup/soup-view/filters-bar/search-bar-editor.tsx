import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import {
  type ItemMention,
  mentionsPlugin,
} from '@core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin';
import { markdownToPlainText } from '@macro-inc/lexical-core/utils/parsers';
import { onElementConnect } from '@solid-primitives/lifecycle';
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  $getRoot,
  $createTextNode,
  $createParagraphNode,
} from 'lexical';
import { INSERT_USER_MENTION_COMMAND } from '@core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin';
import { createSignal, createEffect, onCleanup, Show, createMemo } from 'solid-js';
import { QUERY_FILTERS } from '@app/component/next-soup/filters/query-filters';
import { MentionAutocomplete } from './mention-autocomplete';
import { detectActiveMention } from './parse-search-operators';
import { INDEX_OPTIONS as INDEX_OPTIONS_SOURCE } from './search-filter-controls';
import type { AutocompleteOption } from './search-operator-autocomplete';

interface SearchBarEditorProps {
  initialValue?: string;
  onDismiss?: () => void;
  onFocusReady?: (fn: () => void) => void;
  onHasContentChange?: (has: boolean) => void;
}

export default function SearchBarEditor(props: SearchBarEditorProps) {
  const { setSearchText, setSearchPaused, soup, setQueryFilters } =
    useSoupView();

  const wrapper = createLexicalWrapper({
    type: 'chat',
    namespace: 'soup-search-bar',
    isInteractable: () => true,
  });
  const { editor, plugins, cleanup: cleanupLexical } = wrapper;

  const [markdownState, setMarkdownState] = createSignal('');
  const [searchFocused, setSearchFocused] = createSignal(true);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [mentions, setMentions] = createSignal<ItemMention[]>([]);

  plugins
    .richText()
    .state<string>(setMarkdownState, 'markdown')
    .history(400)
    .use(
      mentionsPlugin({
        setMentions,
        disableMentionTracking: true,
      })
    );

  const plainText = createMemo(() => markdownToPlainText(markdownState()).trim());

  const activeMention = createMemo(() => {
    if (!searchFocused()) return null;
    const md = markdownState();
    // Only detect @ in the plain text portion (not inside XML tags)
    const plain = markdownToPlainText(md);
    return detectActiveMention(plain, plain.length);
  });

  createEffect(() => {
    if (activeMention()) setHighlightedIndex(0);
  });

  createEffect(() => setSearchPaused(!!activeMention()));

  // Sync search text only when mention menu is closed
  createEffect(() => {
    if (!activeMention()) {
      setSearchText(plainText());
    }
  });

  // Sync mention filters from editor state (derived, not accumulated)
  createEffect(() => {
    const mentionIds = mentions()
      .filter((m) => m.itemType === 'user')
      .map((m) => `user:${m.itemId}`);
    syncMentionFilters(mentionIds);
  });

  createEffect(() => {
    props.onHasContentChange?.(markdownState().trim().length > 0);
  });

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

  const handleMentionSelect = (option: AutocompleteOption) => {
    const mention = activeMention();
    if (!mention) return;

    // Remove the @partial text, then insert a UserMentionNode
    editor.update(() => {
      const root = $getRoot();
      const text = root.getTextContent();
      const before = text.slice(0, mention.startIndex);
      const after = text.slice(mention.endIndex);
      root.clear();
      const p = $createParagraphNode();
      if (before) p.append($createTextNode(before));
      root.append(p);
    });

    const email = option.id.split('|').pop() ?? option.id;
    editor.dispatchCommand(INSERT_USER_MENTION_COMMAND, {
      userId: option.id,
      email,
    });

    queueMicrotask(() => editor.focus());
  };

  editor.registerCommand(
    KEY_ENTER_COMMAND,
    (e) => {
      if (activeMention()) {
        e?.preventDefault();
        e?.stopPropagation();
        const root = editor.getRootElement();
        const dropdownEl = root
          ?.closest('[data-search-bar-wrapper]')
          ?.querySelector('[data-operator-dropdown]');
        if (dropdownEl) {
          const buttons = dropdownEl.querySelectorAll('button');
          const idx = highlightedIndex();
          if (buttons[idx]) {
            (buttons[idx] as HTMLButtonElement).click();
          }
        }
      }
      return true;
    },
    COMMAND_PRIORITY_HIGH
  );

  editor.registerCommand(
    KEY_ESCAPE_COMMAND,
    () => {
      props.onDismiss?.();
      return true;
    },
    COMMAND_PRIORITY_HIGH
  );

  const handleKeyDown = (e: KeyboardEvent) => {
    const mention = activeMention();
    if (mention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex((i) => i + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex((i) => Math.max(0, i - 1));
        return;
      }
    }
  };

  onCleanup(cleanupLexical);

  return (
    <div
      class="relative"
      ref={(el) => el.addEventListener('keydown', handleKeyDown, true)}
    >
      <div
        ref={(el) => {
          onElementConnect(el, () => {
            editor.setRootElement(el);
            if (props.initialValue) {
              editor.update(() => {
                const root = $getRoot();
                root.clear();
                const p = $createParagraphNode();
                p.append($createTextNode(props.initialValue!));
                root.append(p);
              });
            }
            props.onFocusReady?.(() => editor.focus());
            setTimeout(() => editor.focus());
          });
        }}
        contentEditable
        class="outline-none [&_p]:my-0"
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
      />
      <DecoratorRenderer editor={editor} />
      <Show when={activeMention()}>
        {(mention) => (
          <MentionAutocomplete
            partial={mention().partial}
            onSelect={handleMentionSelect}
            highlightedIndex={highlightedIndex}
            setHighlightedIndex={setHighlightedIndex}
          />
        )}
      </Show>
    </div>
  );
}
