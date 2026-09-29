import { makeDeleteAction } from '@app/features/next-soup/actions/make-delete-action';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import type {
  ComposeSkillProps,
  ComposeSkillSuccess,
} from '@block-md/component/ComposeSkill';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import type { EntityItem } from '@core/context/quickAccess';
import { searchQuickAccessEntities } from '@core/context/quickAccess/entity-search';
import { useUserId } from '@core/context/user';
import clickOutside from '@core/directive/clickOutside';
import { debouncedDependent } from '@core/util/debounce';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import type { GithubPullRequestEntity } from '@entity';
import PlusIcon from '@phosphor/plus.svg';
import { useSlashMenuPullRequests } from '@queries/soup/slash-menu-pull-requests';
import { useSystemSkillsQuery } from '@queries/storage/system-skills';
import type { SystemSkillSummary } from '@service-storage/generated/schemas/systemSkillSummary';
import { cn, Surface } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createMemo,
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
  type AgentCommandItem,
  CLOSE_AGENT_COMMAND_SEARCH_COMMAND,
  INSERT_AGENT_COMMAND_COMMAND,
  REMOVE_AGENT_COMMAND_SEARCH_COMMAND,
} from '../../../plugins/agent-commands';
import {
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_PR_MENTION_COMMAND,
} from '../../../plugins/mentions';
import {
  CLOSE_SKILL_SEARCH_COMMAND,
  REMOVE_SKILL_SEARCH_COMMAND,
} from '../../../plugins/skills';
import type { MenuOperations } from '../../../shared/inlineMenu';
import { AgentCommandRow } from '../AgentCommandsMenu/AgentCommandRow';
import { filterCommands } from '../AgentCommandsMenu/filterCommands';
import { ItemBin } from '../MentionsMenu/components/ItemBin';
import { MentionsMenuItem } from '../MentionsMenu/components/MentionsMenuItem';
import { useEntityMention } from '../MentionsMenu/hooks/useEntityMention';
import { useMenuKeyboardNavigation } from '../useMenuKeyboardNavigation';
import { PullRequestRow } from './PullRequestRow';
import { SkillActions } from './SkillActions';

false && clickOutside;
false && floatWithSelection;

// Surface border/padding plus the fixed New skill footer.
const PANEL_DECORATION_HEIGHT = 58;

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
  /** Enables the combined agent menu, even before any commands arrive. */
  agentCommands?: () => AgentCommandItem[];
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

  const commands = createMemo(() =>
    filterCommands(props.agentCommands?.() ?? [], activeSearchTerm())
  );
  const { query: pullRequestQuery, pullRequests: allPullRequests } =
    useSlashMenuPullRequests(
      () => !!props.agentCommands && props.menu.isOpen()
    );
  const pullRequests = createMemo(() => {
    if (!props.agentCommands) return [];
    const term = activeSearchTerm().trim().toLowerCase();
    return allPullRequests().filter((item) =>
      `${item.name} ${item.metadata.owner}/${item.metadata.repo} #${item.metadata.number}`
        .toLowerCase()
        .includes(term)
    );
  });
  const commandOffset = () => skills().length + pullRequests().length;
  const newSkillIndex = () => commandOffset() + commands().length;

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

  const itemCount = () => newSkillIndex() + 1;

  createEffect(() => {
    if (selectedIndex() >= itemCount()) {
      setSelectedIndex(itemCount() - 1);
    }
  });

  const closeMenu = () => {
    props.editor.dispatchCommand(
      props.agentCommands
        ? CLOSE_AGENT_COMMAND_SEARCH_COMMAND
        : CLOSE_SKILL_SEARCH_COMMAND,
      undefined
    );
    setMenuOpen(false);
  };

  const removeSearch = () => {
    props.editor.dispatchCommand(
      props.agentCommands
        ? REMOVE_AGENT_COMMAND_SEARCH_COMMAND
        : REMOVE_SKILL_SEARCH_COMMAND,
      undefined
    );
    setMenuOpen(false);
  };

  const insertSkill = (item: EntityItem) => {
    analytics.track('skills_menu_use', {});
    removeSearch();
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

  const insertPullRequest = (item: GithubPullRequestEntity) => {
    removeSearch();
    props.editor.dispatchCommand(INSERT_PR_MENTION_COMMAND, {
      id: item.id,
      label: `${item.metadata.owner}/${item.metadata.repo}#${item.metadata.number}`,
    });
  };

  const insertCommand = (command: AgentCommandItem) => {
    props.editor.dispatchCommand(INSERT_AGENT_COMMAND_COMMAND, command);
    setMenuOpen(false);
  };

  const { popoverSplit, openWithSplit } = useSplitLayout();
  const deleteAction = makeDeleteAction({ userId: useUserId() });

  const editSkill = (item: EntityItem) => {
    closeMenu();
    openWithSplit({ type: 'skill', id: item.id }, { preferNewSplit: true });
  };

  const deleteSkill = (item: EntityItem) => {
    closeMenu();
    void deleteAction.execute([item.data]);
  };

  /**
   * Opens the skill composer dialog; when the skill is created there, its
   * mention is inserted at the cursor so the AI picks it up.
   */
  const createNewSkill = () => {
    removeSearch();
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
      const selectedPullRequest =
        pullRequests()[selectedIndex() - skills().length];
      const selectedCommand = commands()[selectedIndex() - commandOffset()];
      if (selectedItem) {
        itemAction(selectedItem);
      } else if (selectedPullRequest) {
        insertPullRequest(selectedPullRequest);
      } else if (selectedCommand) {
        insertCommand(selectedCommand);
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
    const preferredHeight = props.agentCommands ? 384 : 256;
    if (h === undefined) return preferredHeight;
    return Math.min(preferredHeight, Math.max(0, h - PANEL_DECORATION_HEIGHT));
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
          <Surface depth={2} class="pt-2 pb-1.5 glass bg-menu-glass rounded-xl">
            <div
              class="overflow-y-auto scrollbar-hidden"
              style={{ 'max-height': `${contentMaxHeight()}px` }}
            >
              <ItemBin
                label="Skills"
                binType="skills"
                isSelected={selectedIndex() < skills().length}
              >
                <Show
                  when={skills().length > 0}
                  fallback={
                    <div class="px-3.5 pb-2 text-xs text-ink-extra-muted">
                      {searchTerm() ? 'No matching skills' : 'No skills yet'}
                    </div>
                  }
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
                        actions={
                          <Show
                            when={
                              item.data.ownerId !== '' &&
                              !systemSkills.isSystemSkillId(item.id)
                            }
                          >
                            <SkillActions
                              item={item}
                              onEdit={() => editSkill(item)}
                              onDelete={
                                deleteAction.canExecute(item.data)
                                  ? () => deleteSkill(item)
                                  : undefined
                              }
                            />
                          </Show>
                        }
                      />
                    )}
                  </For>
                </Show>
              </ItemBin>
              <Show when={props.agentCommands}>
                <div class="mt-2 border-t border-edge pt-2">
                  <ItemBin
                    label="Pull requests"
                    binType="pull-requests"
                    isSelected={
                      selectedIndex() >= skills().length &&
                      selectedIndex() < commandOffset()
                    }
                  >
                    <Show
                      when={pullRequests().length > 0}
                      fallback={
                        <div class="px-3.5 pb-2 text-xs text-ink-extra-muted">
                          {pullRequestQuery.isError
                            ? 'Could not load pull requests'
                            : pullRequestQuery.isPending
                              ? 'Loading pull requests…'
                              : 'No matching pull requests'}
                        </div>
                      }
                    >
                      <For each={pullRequests()}>
                        {(item, index) => (
                          <PullRequestRow
                            item={item}
                            selected={
                              selectedIndex() === skills().length + index()
                            }
                            onHover={() =>
                              setSelectedIndexFromMouse(
                                skills().length + index()
                              )
                            }
                            onSelect={() => insertPullRequest(item)}
                          />
                        )}
                      </For>
                    </Show>
                  </ItemBin>
                </div>
                <div class="mt-2 border-t border-edge pt-2">
                  <ItemBin
                    label="Commands"
                    binType="commands"
                    isSelected={
                      selectedIndex() >= commandOffset() &&
                      selectedIndex() < newSkillIndex()
                    }
                  >
                    <Show
                      when={commands().length > 0}
                      fallback={
                        <div class="px-3.5 pb-2 text-xs text-ink-extra-muted">
                          {searchTerm()
                            ? 'No matching commands'
                            : 'No commands available'}
                        </div>
                      }
                    >
                      <For each={commands()}>
                        {(command, index) => (
                          <AgentCommandRow
                            command={command}
                            index={commandOffset() + index()}
                            selected={
                              selectedIndex() === commandOffset() + index()
                            }
                            setIndex={setSelectedIndexFromMouse}
                            itemAction={() => insertCommand(command)}
                          />
                        )}
                      </For>
                    </Show>
                  </ItemBin>
                </div>
              </Show>
            </div>
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
                on:mousemove={() => setSelectedIndexFromMouse(newSkillIndex())}
                class={cn('group flex items-center p-1.5 mx-1.5 rounded-md', {
                  'bg-ink/5': selectedIndex() === newSkillIndex(),
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
