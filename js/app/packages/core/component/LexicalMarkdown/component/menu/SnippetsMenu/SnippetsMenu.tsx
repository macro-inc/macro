import { useAnalytics } from '@app/component/analytics-context';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import type { EntityItem } from '@core/context/quickAccess';
import clickOutside from '@core/directive/clickOutside';
import { debouncedDependent } from '@core/util/debounce';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import { syncServiceClient } from '@service-sync/client';
import { Surface } from '@ui';
import {
  $insertNodes,
  $parseSerializedNode,
  createEditor,
  type LexicalEditor,
} from 'lexical';
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
import { createLexicalWrapper } from '../../../context/LexicalWrapperContext';
import { floatWithSelection } from '../../../directive/floatWithSelection';
import {
  CLOSE_SNIPPET_SEARCH_COMMAND,
  REMOVE_SNIPPET_SEARCH_COMMAND,
} from '../../../plugins/snippets';
import type { MenuOperations } from '../../../shared/inlineMenu';
import {
  editorStateAsMarkdown,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '../../../utils';
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
};

/**
 * Fetch a snippet document's content and render it to internal markdown.
 * Content lives in sync-service; a throwaway markdown editor converts the
 * serialized state to a markdown string the target editor can ingest.
 */
async function fetchSnippetMarkdown(documentId: string): Promise<string> {
  const rawState = await syncServiceClient.getRaw({ documentId });

  const { editor, cleanup } = createLexicalWrapper({
    type: 'markdown',
    namespace: 'snippet-markdown-extractor',
    isInteractable: () => false,
  });

  try {
    initializeEditorWithState(editor, rawState);
    return editorStateAsMarkdown(editor, 'internal');
  } finally {
    cleanup();
  }
}

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
    const count = snippets().length;
    if (count > 0 && selectedIndex() >= count) {
      setSelectedIndex(count - 1);
    }
  });

  const closeMenu = () => {
    props.editor.dispatchCommand(CLOSE_SNIPPET_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
  };

  const insertSnippet = async (item: EntityItem) => {
    analytics.track('snippets_menu_use', {});
    props.editor.dispatchCommand(REMOVE_SNIPPET_SEARCH_COMMAND, undefined);
    props.menu.setSearchTerm('');
    setMenuOpen(false);

    let markdown: string;
    try {
      markdown = await fetchSnippetMarkdown(item.id);
    } catch (error) {
      console.error('failed to load snippet content', error);
      return;
    }
    if (!markdown.trim()) return;

    // Same technique as the markdown paste plugin: parse the markdown with a
    // throwaway editor restricted to the target editor's nodes, then insert
    // the resulting nodes at the cursor.
    props.editor.update(() => {
      const parseEditor = createEditor({
        namespace: 'snippet-parser',
        editable: false,
        nodes: [
          ...Array.from(props.editor._nodes.values()).map((node) => node.klass),
        ],
      });
      setEditorStateFromMarkdown(parseEditor, markdown, 'both');
      const state = parseEditor.getEditorState().toJSON();
      const nodes = state.root.children.map((node) =>
        $parseSerializedNode(node)
      );
      $insertNodes(nodes);
    });
  };

  const itemAction = (item: EntityItem) => {
    void insertSnippet(item);
  };

  useMenuKeyboardNavigation({
    isActive: menuOpen,
    onUp: () => {
      const items = snippets();
      if (items.length === 0) return;
      setSelectedIndex((selectedIndex() - 1 + items.length) % items.length);
    },
    onDown: () => {
      const items = snippets();
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
      const selectedItem = snippets()[selectedIndex()];
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
              when={snippets().length > 0}
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
                <For each={snippets()}>
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
