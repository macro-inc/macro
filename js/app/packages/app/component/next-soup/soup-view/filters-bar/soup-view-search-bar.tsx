import { useSoup } from '@app/component/next-soup/soup-context';
import { registerSearchSplit } from '@app/component/next-soup/soup-view/search-controllers';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { registerHotkey } from '@core/hotkey/hotkeys';
import XIcon from '@icon/x.svg?component-solid';
import { markdownToPlainText } from '@lexical-core/utils/parsers';
import SearchIcon from '@macro-icons/macro-magnifying-glass.svg';
import { cn, Hotkey } from '@ui';
import {
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
} from 'lexical';
import {
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

type SearchbarVariant = 'filled' | 'secondary';

interface SoupSearchbarProps {
  variant?: SearchbarVariant;
  autoFocus?: boolean;
  onDismiss?: () => void;
  placeholder?: string;
  initialValue?: string;
}

const variantStyles: Record<SearchbarVariant, string> = {
  filled:
    'bg-ink/5 text-ink-muted hover:bg-ink/7 hover:text-ink border-edge-muted focus-within:bg-ink/7 focus-within:text-ink',
  secondary:
    'bg-transparent text-ink-muted border-edge-muted hover:bg-surface hover:text-ink focus-within:bg-surface focus-within:text-ink',
};

export const SoupSearchbar = (props: SoupSearchbarProps) => {
  const { setSearchText, setSearchPaused, queryFilters } = useSoupView();
  const soup = useSoup();
  const panel = useSplitPanelOrThrow();

  const [hasContent, setHasContent] = createSignal(false);
  const [latestMarkdown, setLatestMarkdown] = createSignal('');

  const editor = buildConfig('chat')
    .namespace('soup-search-bar')
    .singleLine()
    .withMentions({
      sources: ['users'],
      disableMentionTracking: true,
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
    })
    .use((lex) =>
      lex.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        () => {
          if (menuIsOpen()) return false;
          lex.getRootElement()?.blur();
          return true;
        },
        COMMAND_PRIORITY_HIGH
      )
    );

  // Sync search text only when the mention menu is closed. This avoids
  // cascading reactive updates during mention insertion and prevents search
  // from firing while typing @partial.
  const menuIsOpen = () => editor.controls.isInlineMenuOpen();

  createEffect(() => setSearchPaused(menuIsOpen()));

  createEffect(
    on(latestMarkdown, (markdown) => {
      if (menuIsOpen()) return;
      setSearchText(markdownToPlainText(markdown).trim());
    })
  );

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

  onMount(() => {
    const content = panel.handle.content();
    if (content.type !== 'component' || content.id !== 'search') return;
    const dispose = registerSearchSplit(panel.handle.id, {
      applyOverrides: ({ query, filters, clientFilters }) => {
        batch(() => {
          editor.controls.setMarkdown(query);
          editor.controls.getLexical().update(() => {
            $getRoot().selectEnd();
          });
          editor.controls.blur();
          queryFilters.replace(filters);
          soup.predicates.set(clientFilters);
        });
        // Restore focus to the split panel so hotkey navigation works. The
        // command menu suppresses Kobalte's onCloseAutoFocus for search
        // rows so this stays put without needing a delay.
        queueMicrotask(() => panel.panelRef()?.focus({ preventScroll: true }));
      },
      focus: () => {
        setTimeout(() => editor.controls.focus());
      },
    });
    onCleanup(dispose);
  });

  return (
    <div
      class="w-full flex items-center shrink-0 grow min-w-0 mobile:-order-2"
      data-search-bar-wrapper
      data-no-focus-restore
      onFocusOut={(e) => {
        if (hasContent() || !props.onDismiss) return;
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        props.onDismiss();
      }}
    >
      <div
        class={cn(
          'group w-full relative flex items-center gap-1 rounded-md h-7 mobile:h-9 pl-2 pr-1 mobile:min-w-35 border text-xs',
          variantStyles[props.variant ?? 'secondary']
        )}
      >
        <SearchIcon class="size-4 shrink-0" />
        <div
          data-soup-search
          class="flex-1 min-w-0 whitespace-nowrap overflow-hidden **:[[contenteditable]]:outline-none **:[[contenteditable]]:p-0 **:[[contenteditable]]:whitespace-nowrap [&_p]:my-0 [&_p]:whitespace-nowrap"
        >
          <MarkdownShell
            config={editor}
            placeholder={props.placeholder ?? 'Search'}
            autofocus={props.autoFocus}
            initialValue={props.initialValue}
            class="min-h-0! overflow-visible!"
          />
        </div>
        <Show
          when={!hasContent() && !props.onDismiss && !!searchHotkey.hotkey()}
        >
          <div class="shrink-0 text-xxs text-ink-extra-muted/50 rounded-sm border border-ink/5 px-1.5 py-px group-focus-within:hidden">
            <Hotkey shortcut={searchHotkey.hotkey()} class="flex gap-1" />
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
    </div>
  );
};
