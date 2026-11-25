import {
  type SearchOperatorCompletion,
  searchOperatorBeingTyped,
  searchOperatorCompletions,
  searchTokenAtEnd,
} from '@app/features/next-soup/core/search-operator-completions';
import type { SearchOperatorBinding } from '@app/features/next-soup/core/search-operators';
import { useSoup } from '@app/features/next-soup/soup-context';
import { registerSearchSplit } from '@app/features/next-soup/soup-view/search-controllers';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import type { EditorControls } from '@core/component/LexicalMarkdown/builder/types';
import { registerHotkey } from '@core/hotkey/hotkeys';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import XIcon from '@icon/system/regular/x.svg?component-solid';
import { markdownToSearchText } from '@macro-inc/lexical-core/utils/parsers';
import { cn, Hotkey } from '@ui';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $selectAll,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
} from 'lexical';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { createSearchOperatorLookup } from '../search-operator-lookup';
import { searchOperatorHighlights } from './search-operator-highlight';
import { SearchOperatorSuggestions } from './search-operator-suggestions';
import { createSearchOperatorValues } from './search-operator-values';

type SearchbarVariant = 'filled' | 'secondary';
interface SoupSearchbarProps {
  variant?: SearchbarVariant;
  autoFocus?: boolean;
  onDismiss?: () => void;
  placeholder?: string;
  initialValue?: string;
  /** Offer the search operators as they are typed. */
  operators?: boolean;
  /**
   * The suggestion rows go to the page's top layer, pinned under the field,
   * for a field inside a split header, which clips what overflows it. In a
   * dialog they stay inline, inside its scope.
   */
  floatingSuggestions?: boolean;
}

// Both variants draw the shared SearchBar pill; they differ only in emphasis.
const variantStyles: Record<SearchbarVariant, string> = {
  filled: 'text-ink-muted focus-within:text-ink',
  secondary: 'text-ink-muted hover:text-ink focus-within:text-ink',
};

/**
 * The field's text as typed: its markdown flattened, with the backslashes
 * markdown puts before punctuation taken back out, so `status:in_progress`
 * reaches the search as typed rather than as `in\\_progress`.
 */
export const searchTextOf = (markdown: string) =>
  markdownToSearchText(markdown).replace(/\\([!-/:-@[-`{-~])/g, '$1');

/**
 * A plain query as the editor's markdown. Its addresses stay text: imported,
 * `from:ana@example.com` would become a mail link that swallows the space
 * typed after it.
 */
const queryMarkdown = (query: string) =>
  query.replace(/<[^>]*>|@/g, (match) => (match === '@' ? '\\@' : match));

/** Split-owned history, focus shortcuts and navigation around the shared search input. */
export function SoupSearchbar(props: SoupSearchbarProps) {
  const {
    searchText,
    setSearchText,
    searchBindings,
    setSearchBindings,
    setSearchPaused,
    queryFilters,
    provideOperatorLookup,
    tagFilter,
  } = useSoupView();
  provideOperatorLookup(createSearchOperatorLookup(tagFilter));
  onCleanup(() => provideOperatorLookup(undefined));
  const soup = useSoup();
  const panel = useSplitPanelOrThrow();
  const persisted = panel.handle.currentEntryState()?.['search.text'];
  const initialValue =
    typeof persisted === 'string'
      ? persisted
      : searchText() || props.initialValue || '';
  if (searchText() !== initialValue) setSearchText(initialValue);
  let controls: EditorControls | undefined;
  const hotkey = registerHotkey({
    hotkey: 'cmd+f',
    scopeId: panel.splitHotkeyScope,
    registrationType: 'add',
    description: 'Search',
    runWithInputFocused: true,
    keyDownHandler: () => {
      if (!controls) return false;
      controls.focus();
      controls.getLexical().update(() => $selectAll());
      return true;
    },
  });
  onMount(() => {
    const content = panel.handle.content();
    if (content.type !== 'component' || content.id !== 'search') return;
    onCleanup(
      registerSearchSplit(panel.handle.id, {
        applyOverrides: ({ query, bindings, filters, clientFilters }) => {
          batch(() => {
            setSearchBindings(bindings ?? []);
            controls?.setMarkdown(queryMarkdown(query));
            controls?.getLexical().update(() => $getRoot().selectEnd());
            controls?.blur();
            setSearchText(query);
            queryFilters.replace(filters);
            soup.predicates.set(clientFilters);
          });
          queueMicrotask(() =>
            panel.panelRef()?.focus({ preventScroll: true })
          );
        },
        focus: () => {
          setTimeout(() => controls?.focus());
        },
      })
    );
  });
  return (
    <SearchbarInput
      {...props}
      operators
      floatingSuggestions
      bindings={searchBindings()}
      value={searchText()}
      initialValue={initialValue}
      onChange={setSearchText}
      onPauseChange={setSearchPaused}
      shortcut={hotkey.hotkey()}
      onConnect={(value) => {
        controls = value;
      }}
    />
  );
}

/** The global Search editor, usable without a soup view or split context. */
export function SearchbarInput(
  props: SoupSearchbarProps & {
    value: string;
    onChange: (value: string) => void;
    onPauseChange?: (paused: boolean) => void;
    onConnect?: (controls: EditorControls) => void;
    shortcut?: string;
    label?: string;
    /** What openers' tokens in the field stand for, drawn as operators. */
    bindings?: readonly SearchOperatorBinding[];
  }
) {
  // Keep rich editor markup separate from the plain query acknowledged by the host.
  const [markdown, setMarkdown] = createSignal(
    untrack(() => queryMarkdown(props.initialValue ?? props.value))
  );
  let acknowledgedQuery = searchTextOf(props.value).trim();

  // The operator rows offered for what is typed at the field's end.
  const fieldText = createMemo(() => searchTextOf(markdown()));
  const typing = createMemo(() =>
    props.operators ? searchOperatorBeingTyped(fieldText()) : undefined
  );
  const personTyped = () => {
    const typed = typing();
    if (!typed || !('name' in typed)) return undefined;
    const names = ['assignee', 'author', 'from'];
    return names.includes(typed.name) ? typed.value : undefined;
  };
  const operatorValues = props.operators
    ? createSearchOperatorValues(personTyped)
    : undefined;
  const [focused, setFocused] = createSignal(false);
  const [dismissedFor, setDismissedFor] = createSignal<string>();
  const operatorRows = createMemo(() =>
    operatorValues && focused() && dismissedFor() !== fieldText()
      ? searchOperatorCompletions(fieldText(), operatorValues())
      : []
  );
  // The active row belongs to the text it was chosen for; typing resets it.
  const [activeRow, setActiveRow] = createSignal({ text: '', index: -1 });
  const activeIndex = () =>
    activeRow().text === fieldText() ? activeRow().index : -1;
  const moveActive = (step: number) => {
    const count = operatorRows().length;
    const next = Math.max(-1, Math.min(count - 1, activeIndex() + step));
    setActiveRow({ text: fieldText(), index: next });
  };
  const listId = createUniqueId();
  const publish = (value: string) => {
    setMarkdown(value);
    if (editor.controls.isInlineMenuOpen()) return;
    const text = searchTextOf(value).trim();
    acknowledgedQuery = text;
    if (text !== props.value) props.onChange(text);
  };
  createEffect(
    on(
      () => props.value,
      (value) => {
        const query = searchTextOf(value).trim();
        if (query === acknowledgedQuery) return;
        acknowledgedQuery = query;
        setMarkdown(queryMarkdown(value));
      }
    )
  );
  const editor = buildConfig('chat')
    .namespace('soup-search-bar')
    .singleLine()
    .withMentions({ sources: ['users'], disableMentionTracking: true })
    .withHistory({ timeGap: 400 })
    .onChange(publish)
    .onEnter(() => {
      if (editor.controls.isInlineMenuOpen()) return false;
      const row = operatorRows()[activeIndex()];
      if (row) {
        pickOperator(row);
        return true;
      }
      editor.controls.blur();
      return true;
    })
    .onEscape(() => {
      if (operatorRows().length > 0) {
        setDismissedFor(fieldText());
        setActiveRow({ text: '', index: -1 });
        return true;
      }
      editor.controls.blur();
      props.onDismiss?.();
      return true;
    })
    .onTab(() => false)
    .use(searchOperatorHighlights(() => props.bindings ?? []))
    .use((lex) =>
      lex.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        () => {
          if (editor.controls.isInlineMenuOpen()) return false;
          // Past the last row the keyboard goes on to the results, as Mail's.
          if (activeIndex() < operatorRows().length - 1) {
            moveActive(1);
            return true;
          }
          lex.getRootElement()?.blur();
          return true;
        },
        COMMAND_PRIORITY_HIGH
      )
    )
    .use((lex) =>
      lex.registerCommand(
        KEY_ARROW_UP_COMMAND,
        () => {
          if (operatorRows().length === 0 || activeIndex() < 0) return false;
          moveActive(-1);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      )
    );
  const pickOperator = (row: SearchOperatorCompletion) => {
    const typed = searchTokenAtEnd(fieldText()) ?? '';
    editor.controls.getLexical().update(() => {
      $getRoot().selectEnd();
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      // The typed token ends the field's last text, so it is replaced as one
      // range there: deleting it a character at a time miscounts a cluster
      // such as an emoji with its skin tone.
      const node = selection.anchor.getNode();
      const end = selection.anchor.offset;
      if (
        $isTextNode(node) &&
        node.getTextContent().slice(0, end).endsWith(typed)
      ) {
        selection.setTextNodeRange(node, end - typed.length, node, end);
      } else {
        // Across text nodes, it is deleted one cluster at a time.
        const clusters = [...new Intl.Segmenter().segment(typed)].length;
        for (let index = 0; index < clusters; index++) {
          selection.deleteCharacter(true);
        }
      }
      selection.insertText(row.insert);
    });
  };
  const hasContent = () => !!markdown().trim();
  const suggestions = () => (
    <SearchOperatorSuggestions
      rows={operatorRows()}
      active={activeIndex()}
      listId={listId}
      onPick={(index) => {
        const row = operatorRows()[index];
        if (row) pickOperator(row);
      }}
    />
  );
  // Floating rows sit in a portal under the field: a split header clips
  // what overflows it, so a menu inside would be hidden and let clicks reach
  // the results beneath. They are measured again as the rows change.
  let wrapper: HTMLDivElement | undefined;
  const [anchor, setAnchor] = createSignal<DOMRect>();
  createEffect(() => {
    if (!props.floatingSuggestions) return;
    if (operatorRows().length === 0 || !wrapper) return;
    const field = wrapper;
    const measure = () => setAnchor(field.getBoundingClientRect());
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    });
  });
  createEffect(
    on(
      () => editor.controls.isInlineMenuOpen(),
      (open, wasOpen) => {
        props.onPauseChange?.(open);
        if (wasOpen && !open) untrack(() => publish(markdown()));
      }
    )
  );
  return (
    <div
      ref={wrapper}
      class="relative w-full items-center shrink-0 grow min-w-0 mobile:-order-2"
      data-search-bar-wrapper
      data-no-focus-restore
      onFocusIn={() => setFocused(true)}
      onFocusOut={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) return;
        setFocused(false);
        if (hasContent() || !props.onDismiss) return;
        props.onDismiss();
      }}
    >
      <div
        class={cn(
          'group w-full relative flex items-center gap-1.5 rounded-full h-8 mobile:h-9 px-3 mobile:min-w-35 border border-edge-button bg-control not-touch:elevated text-sm focus-within:ring-2 focus-within:ring-edge-muted',
          variantStyles[props.variant ?? 'secondary']
        )}
      >
        <SearchIcon class="size-4 shrink-0" />
        <div
          data-soup-search
          class="flex-1 min-w-0 whitespace-nowrap overflow-hidden **:[[contenteditable]]:outline-none **:[[contenteditable]]:p-0 **:[[contenteditable]]:whitespace-nowrap **:[[contenteditable]]:min-h-lh [&_p]:my-0 [&_p]:whitespace-nowrap"
        >
          <MarkdownShell
            config={editor}
            placeholder={props.placeholder ?? 'Search'}
            autofocus={props.autoFocus}
            value={markdown()}
            class="min-h-0! overflow-visible!"
            ariaLabel={props.label ?? 'Search'}
            onConnect={() => {
              props.onConnect?.(editor.controls);
            }}
          />
        </div>
        <Show when={!hasContent() && !props.onDismiss && props.shortcut}>
          <div class="shrink-0 text-xxs text-ink-extra-muted rounded-sm border border-ink/5 px-1.5 py-px group-focus-within:hidden">
            <Hotkey shortcut={props.shortcut} class="flex gap-1" />
          </div>
        </Show>
        <Show when={hasContent() || props.onDismiss}>
          <button
            type="button"
            aria-label="Clear search"
            class="ml-auto size-4 mobile:size-6 shrink-0 hover:opacity-60"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMarkdown('');
              acknowledgedQuery = '';
              props.onChange('');
              props.onDismiss?.();
            }}
          >
            <XIcon class="size-4 mobile:size-6" />
          </button>
        </Show>
      </div>
      <Show when={operatorRows().length > 0}>
        <Show
          when={props.floatingSuggestions && anchor()}
          fallback={
            <div class="absolute top-full left-0 z-item-options-menu mt-1 w-full">
              {suggestions()}
            </div>
          }
        >
          {(rect) => (
            <Portal>
              <div
                class="fixed z-action-menu"
                style={{
                  top: `${rect().bottom + 4}px`,
                  left: `${rect().left}px`,
                  width: `${rect().width}px`,
                }}
              >
                {suggestions()}
              </div>
            </Portal>
          )}
        </Show>
      </Show>
    </div>
  );
}
