import { useAnalytics } from '@app/component/analytics-context';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import type { EntityItem } from '@core/context/quickAccess';
import clickOutside from '@core/directive/clickOutside';
import { debouncedDependent } from '@core/util/debounce';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import { fetchSnippetRaw } from '@queries/storage/snippets';
import { Surface } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { floatWithSelection } from '../../../directive/floatWithSelection';
import {
  CLOSE_SNIPPET_SEARCH_COMMAND,
  INSERT_SNIPPET_COMMAND,
} from '../../../plugins/snippets';
import type { MenuOperations } from '../../../shared/inlineMenu';
import { MentionsMenuItem } from '../MentionsMenu/components/MentionsMenuItem';
import { useEntityMention } from '../MentionsMenu/hooks/useEntityMention';
import { useMenuKeyboardNavigation } from '../useMenuKeyboardNavigation';

false && clickOutside;
false && floatWithSelection;

// Height consumed by Surface's border + vertical padding
const PANEL_DECORATION_HEIGHT = 18;

type SnippetsMenuProps = {
  editor: LexicalEditor;
  menu: MenuOperations;
  /** whether the menu checks against block boundary in floating middleware. uses floating-ui default if false. */
  useBlockBoundary?: boolean;
  portalScope?: PortalScope;
  sourceDocumentId?: string;
};

/**
 * Typeahead menu opened by typing `;` in a markdown area. Lists snippet
 * documents the user can access (their own + team-shared); selecting one
 * inserts the snippet's markdown body at the cursor.
 */
export function SnippetsMenu(props: SnippetsMenuProps) {
  return (
    <Suspense>
      <SnippetsMenuInner {...props} />
    </Suspense>
  );
}

function SnippetsMenuInner(props: SnippetsMenuProps) {
  const analytics = useAnalytics();

  const searchTerm = debouncedDependent(props.menu.searchTerm, 60);

  const { searchedEntities: snippets } = useEntityMention({
    buckets: ['snippet'],
    searchTerm,
  });
  const filteredSnippets = () =>
    snippets().filter((snippet) => snippet.id !== props.sourceDocumentId);

  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [mountSelection, setMountSelection] = createSignal<Selection | null>();
  const [escapeSpaceState, setEscapeSpaceState] = createSignal<
    'start' | 'single' | null
  >('start');

  const { isKeypressActive } = useIsKeyPressActive();
  const setSelectedIndexFromMouse = (index: number) => {
    if (isKeypressActive()) return;
    setSelectedIndex(index);
  };

  const [menuOpen, setMenuOpen] = [props.menu.isOpen, props.menu.setIsOpen];

  createEffect(() => {
    if (menuOpen()) {
      setMountSelection(document.getSelection());
      setSelectedIndex(0);
      setEscapeSpaceState('start');
    } else {
      setMountSelection(null);
    }
  });

  createEffect(() => {
    searchTerm();
    setSelectedIndex(0);
  });

  createEffect(() => {
    const count = filteredSnippets().length;
    if (count > 0 && selectedIndex() >= count) {
      setSelectedIndex(count - 1);
    }
  });

  const closeMenu = () => {
    props.editor.dispatchCommand(CLOSE_SNIPPET_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
  };

  const insertSnippet = (item: EntityItem) => {
    analytics.track('snippets_menu_use', {});
    props.editor.dispatchCommand(INSERT_SNIPPET_COMMAND, {
      documentId: item.id,
      sourceDocumentId: props.sourceDocumentId,
      fetchSnippet: () => fetchSnippetRaw({ documentId: item.id }),
    });
  };

  const itemAction = (item: EntityItem) => {
    insertSnippet(item);
  };

  useMenuKeyboardNavigation({
    isActive: menuOpen,
    onUp: () => {
      const items = filteredSnippets();
      if (items.length === 0) return;
      setSelectedIndex((selectedIndex() - 1 + items.length) % items.length);
    },
    onDown: () => {
      const items = filteredSnippets();
      if (items.length === 0) return;
      setSelectedIndex((selectedIndex() + 1) % items.length);
    },
    onLeft: () => {
      // block horizontal arrows
    },
    onRight: () => {
      // block horizontal arrows
    },
    onSelect: () => {
      const selectedItem = filteredSnippets()[selectedIndex()];
      if (selectedItem) {
        itemAction(selectedItem);
      } else {
        closeMenu();
      }
    },
    onClose: closeMenu,
    onSpace: () => {
      switch (escapeSpaceState()) {
        case 'single':
        case 'start':
          closeMenu();
          return true;
        case null:
          setEscapeSpaceState('single');
          return false;
      }
      return false;
    },
    onOtherKey: () => {
      setEscapeSpaceState(null);
    },
  });

  const focusOut = () => {
    closeMenu();
  };
  onMount(() => {
    document.addEventListener('focusout', focusOut);
    onCleanup(() => {
      document.removeEventListener('focusout', focusOut);
    });
  });

  const [menuAvailableHeight, setMenuAvailableHeight] = createSignal<
    number | undefined
  >(undefined);

  const contentMaxHeight = () => {
    const h = menuAvailableHeight();
    if (h === undefined) return 256;
    return Math.min(256, Math.max(0, h - PANEL_DECORATION_HEIGHT));
  };

  return (
    <Show when={menuOpen()}>
      <ScopedPortal scope={props.portalScope}>
        <div
          class="w-96 max-w-[calc(100cqw-1rem-2px)] cursor-default select-none z-modal-content"
          use:floatWithSelection={{
            selection: untrack(mountSelection),
            reactiveOnContainer: props.editor.getRootElement(),
            useBlockBoundary: props.useBlockBoundary,
            onAvailableHeight: setMenuAvailableHeight,
          }}
          use:clickOutside={() => {
            closeMenu();
          }}
          on:touchstart={(e) => e.stopPropagation()}
        >
          <Surface
            depth={2}
            class="pt-2 pb-1.5 shadow-lg shadow-drop-shadow rounded-xl"
          >
            <div class="px-3.5 pb-1 text-xs font-medium text-ink-muted">
              Snippets
            </div>
            <Show
              when={filteredSnippets().length > 0}
              fallback={
                <div class="px-3.5 pb-1 text-ink-extra-muted">
                  {searchTerm() ? 'No results' : 'No snippets yet'}
                </div>
              }
            >
              <div
                class="overflow-y-auto scrollbar-hidden"
                style={{ 'max-height': `${contentMaxHeight()}px` }}
              >
                <For each={filteredSnippets()}>
                  {(item, index) => (
                    <MentionsMenuItem
                      item={item}
                      index={index()}
                      selected={index() === selectedIndex()}
                      itemAction={() => itemAction(item)}
                      setIndex={setSelectedIndexFromMouse}
                      setOpen={setMenuOpen}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Surface>
        </div>
      </ScopedPortal>
    </Show>
  );
}
