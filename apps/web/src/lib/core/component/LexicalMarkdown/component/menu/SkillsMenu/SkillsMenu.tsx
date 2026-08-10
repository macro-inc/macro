import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type {
  ComposeSkillProps,
  ComposeSkillSuccess,
} from '@block-md/component/ComposeSkill';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import type { EntityItem } from '@core/context/quickAccess';
import { searchQuickAccessEntities } from '@core/context/quickAccess/entity-search';
import clickOutside from '@core/directive/clickOutside';
import { debouncedDependent } from '@core/util/debounce';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import PlusIcon from '@phosphor/plus.svg';
import { useSystemSkillsQuery } from '@queries/storage/system-skills';
import type { SystemSkillSummary } from '@service-storage/generated/schemas/systemSkillSummary';
import { cn, Surface } from '@ui';
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
import { INSERT_DOCUMENT_MENTION_COMMAND } from '../../../plugins/mentions';
import {
  CLOSE_SKILL_SEARCH_COMMAND,
  REMOVE_SKILL_SEARCH_COMMAND,
} from '../../../plugins/skills';
import type { MenuOperations } from '../../../shared/inlineMenu';
import { MentionsMenuItem } from '../MentionsMenu/components/MentionsMenuItem';
import { useEntityMention } from '../MentionsMenu/hooks/useEntityMention';
import { useMenuKeyboardNavigation } from '../useMenuKeyboardNavigation';

false && clickOutside;
false && floatWithSelection;

// Height consumed by Surface's border + vertical padding
const PANEL_DECORATION_HEIGHT = 18;

/**
 * A built-in system skill as a menu item. System skills are static strings in
 * code, not documents, so they are appended to the quick-access list here
 * rather than flowing through the soup queries.
 */
function systemSkillItem(skill: SystemSkillSummary): EntityItem {
  return {
    kind: 'entity',
    id: skill.id,
    bucket: 'skill',
    searchText: skill.name.toLowerCase(),
    sortTimestamp: 0,
    timestamps: {},
    data: {
      id: skill.id,
      name: skill.name,
      ownerId: '',
      type: 'document',
      fileType: 'md',
      subType: { type: 'skill' },
    },
  };
}

type SkillsMenuProps = {
  editor: LexicalEditor;
  menu: MenuOperations;
  /** whether the menu checks against block boundary in floating middleware. uses floating-ui default if false. */
  useBlockBoundary?: boolean;
  portalScope?: PortalScope;
};

/**
 * Typeahead menu opened by typing `/` in an AI markdown area. Lists skill
 * documents the user can access; selecting one inserts a document mention
 * for the skill at the cursor, which the AI reads with its document tools.
 */
export function SkillsMenu(props: SkillsMenuProps) {
  return (
    <Suspense>
      <SkillsMenuInner {...props} />
    </Suspense>
  );
}

function SkillsMenuInner(props: SkillsMenuProps) {
  const analytics = useAnalytics();

  const searchTerm = debouncedDependent(props.menu.searchTerm, 60);
  const activeSearchTerm = () => (props.menu.isOpen() ? searchTerm() : '');

  const { entities: userSkills } = useEntityMention({
    buckets: ['skill'],
    searchTerm: activeSearchTerm,
  });

  const systemSkills = useSystemSkillsQuery();
  const systemSkillItems = () => systemSkills.skills().map(systemSkillItem);

  // User skills first, system skills at the bottom, both narrowed by the
  // active search term.
  const skills = () => [
    ...userSkills(),
    ...searchQuickAccessEntities(systemSkillItems(), activeSearchTerm()),
  ];

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

  // Selectable rows: every skill plus the trailing "New skill" row.
  const itemCount = () => skills().length + 1;

  createEffect(() => {
    if (selectedIndex() >= itemCount()) {
      setSelectedIndex(itemCount() - 1);
    }
  });

  const closeMenu = () => {
    props.editor.dispatchCommand(CLOSE_SKILL_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
  };

  const insertSkill = (item: EntityItem) => {
    analytics.track('skills_menu_use', {});
    props.editor.dispatchCommand(REMOVE_SKILL_SEARCH_COMMAND, undefined);
    props.editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
      documentId: item.id,
      documentName: item.data.name ?? '',
      blockName: 'skill',
    });
    setMenuOpen(false);
  };

  const itemAction = (item: EntityItem) => {
    insertSkill(item);
  };

  const { popoverSplit } = useSplitLayout();

  /**
   * Opens the skill composer dialog; when the skill is created there, its
   * mention is inserted at the cursor so the AI picks it up.
   */
  const createNewSkill = () => {
    props.editor.dispatchCommand(REMOVE_SKILL_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
    const onSuccess = ({ documentId, title }: ComposeSkillSuccess) => {
      props.editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
        documentId,
        documentName: title,
        blockName: 'skill',
      });
    };
    popoverSplit({
      type: 'component',
      id: 'skill-compose',
      params: { onSuccess } satisfies ComposeSkillProps,
    });
  };

  useMenuKeyboardNavigation({
    isActive: menuOpen,
    onUp: () => {
      setSelectedIndex((selectedIndex() - 1 + itemCount()) % itemCount());
    },
    onDown: () => {
      setSelectedIndex((selectedIndex() + 1) % itemCount());
    },
    onLeft: () => {
      // block horizontal arrows
    },
    onRight: () => {
      // block horizontal arrows
    },
    onSelect: () => {
      const selectedItem = skills()[selectedIndex()];
      if (selectedItem) {
        itemAction(selectedItem);
      } else {
        void createNewSkill();
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
          class="w-96 max-w-[calc(100cqw-1rem-2px)] cursor-default select-none z-modal-content menu-open-animation"
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
              Skills
            </div>
            <Show
              when={skills().length > 0}
              fallback={
                <div class="px-3.5 pb-1 text-ink-extra-muted">
                  {searchTerm() ? 'No results' : 'No skills yet'}
                </div>
              }
            >
              <div
                class="overflow-y-auto scrollbar-hidden"
                style={{ 'max-height': `${contentMaxHeight()}px` }}
              >
                <For each={skills()}>
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
            <div class="mt-1 pt-1 border-t border-edge">
              <div
                on:mouseup={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                on:mousedown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                on:click={(e) => {
                  void createNewSkill();
                  e.stopPropagation();
                }}
                on:mousemove={() => setSelectedIndexFromMouse(skills().length)}
                class={cn('group flex items-center p-1.5 mx-1.5 rounded-md', {
                  'bg-ink/5': selectedIndex() === skills().length,
                })}
              >
                <div class="mr-2 flex items-center">
                  <PlusIcon class="size-4 text-ink-muted" />
                </div>
                <span class="text-ink text-xs sm:text-sm font-medium">
                  New skill
                </span>
              </div>
            </div>
          </Surface>
        </div>
      </ScopedPortal>
    </Show>
  );
}
