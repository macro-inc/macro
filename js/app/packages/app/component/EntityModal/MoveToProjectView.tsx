import { scrollToKeepGap } from '@app/component/SoupContext';
import { BozzyBracket } from '@core/component/BozzyBracket';
import {
  CustomEntityIcon,
  EntityIcon,
  getIconConfig,
} from '@core/component/EntityIcon';
import { ExplorerSpacer } from '@core/component/FileList/ExplorerSpacer';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import Fragment from '@core/util/Fragment';
import CaretRight from '@icon/regular/caret-right.svg';
import ArrowRight from '@phosphor-icons/core/regular/arrow-right.svg?component-solid';
import type { Project } from '@service-storage/generated/schemas';
import { useProjects } from '@service-storage/projects';
import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';
import { VList } from 'virtua/solid';
import { createMoveToProjectDssEntityMutation } from '../../../macro-entity/src/queries/dss';
import type { EntityData } from '../../../macro-entity/src/types/entity';
import { EntityModalActionFooter, EntityModalTitle } from './EntityModal';

export const MoveToProjectView = (props: {
  entity: EntityData;
  onFinish: () => void;
  onCancel: () => void;
}) => {
  let listRef!: HTMLDivElement;
  const moveToProjectMutation = createMoveToProjectDssEntityMutation();
  const projects = useProjects();
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedProject, setSelectedProject] = createSignal<Project | null>(
    null
  );
  const [expandedProjects, setExpandedProjects] = createSignal<{
    [key: string]: boolean;
  }>({});
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [attachHotkeys, moveToProjectHotkeyScopeId] = useHotkeyDOMScope(
    'move-to-project',
    true
  );
  let rootScopeId!: HTMLDivElement;

  onMount(() => {
    attachHotkeys(rootScopeId);
    registerHotkey({
      hotkey: ['arrowdown'],
      scopeId: moveToProjectHotkeyScopeId,
      description: 'Down',
      keyDownHandler: () => {
        const items = flattenedProjects.items;
        if (items.length === 0) return false;

        const currentIndex = focusedIndex();
        const nextIndex =
          currentIndex === -1
            ? 0
            : Math.min(currentIndex + 1, items.length - 1);
        setFocusedIndex(nextIndex);

        // Update selection
        const nextProject = items[nextIndex];
        if (nextProject) {
          setSelectedProject(nextProject);
          scrollToKeepGap({
            container: listRef,
            target: listRef.querySelector('.focused') as HTMLElement,
            align: 'bottom',
          });
        }
        return true;
      },
      runWithInputFocused: true,
    });
    registerHotkey({
      hotkey: ['arrowup'],
      scopeId: moveToProjectHotkeyScopeId,
      description: 'Up',
      keyDownHandler: () => {
        const items = flattenedProjects.items;
        if (items.length === 0) return false;

        const currentIndex = focusedIndex();
        const prevIndex =
          currentIndex === -1
            ? items.length - 1
            : Math.max(currentIndex - 1, 0);
        setFocusedIndex(prevIndex);

        // Update selection
        const prevProject = items[prevIndex];
        if (prevProject) {
          setSelectedProject(prevProject);
          scrollToKeepGap({
            container: listRef,
            target: listRef.querySelector('.focused') as HTMLElement,
            align: 'top',
          });
        }
        return true;
      },
      runWithInputFocused: true,
    });
    registerHotkey({
      hotkey: ['arrowright'],
      scopeId: moveToProjectHotkeyScopeId,
      description: 'Expand',
      keyDownHandler: () => {
        const items = flattenedProjects.items;
        const currentIndex = focusedIndex();
        if (currentIndex === -1) return false;
        const currentProject = items[currentIndex];

        if (currentProject && !searchQuery()) {
          // Check if project has children and is not expanded
          const tree = projectTree();
          const hasChildren =
            tree.itemMap[currentProject.id]?.children.length > 0;
          const isExpanded = expandedProjects()[currentProject.id];

          if (hasChildren && !isExpanded) {
            toggleExpanded(currentProject.id);
            return true;
          } else if (hasChildren && isExpanded) {
            // If already expanded, try to jump to first child
            const children = tree.itemMap[currentProject.id]?.children || [];
            if (children.length > 0) {
              const firstChild = children[0];
              const firstChildIndex = items.findIndex(
                (item) => item.id === firstChild.id
              );
              if (firstChildIndex !== -1) {
                setFocusedIndex(firstChildIndex);
                setSelectedProject(items[firstChildIndex]);
                scrollToKeepGap({
                  container: listRef,
                  target: listRef.querySelector('.focused') as HTMLElement,
                  align: 'top',
                });
                return true;
              }
            }
          }
        }
        return false;
      },
      runWithInputFocused: true,
    });
    registerHotkey({
      hotkey: ['arrowleft'],
      scopeId: moveToProjectHotkeyScopeId,
      description: 'Collapse',
      keyDownHandler: () => {
        const items = flattenedProjects.items;
        const currentIndex = focusedIndex();
        if (currentIndex === -1) return false;
        const currentProject = items[currentIndex];

        if (currentProject && !searchQuery()) {
          // Check if project is expanded
          const isExpanded = expandedProjects()[currentProject.id];

          if (isExpanded) {
            toggleExpanded(currentProject.id);
            return true;
          } else {
            // If already collapsed, try to jump to parent directory
            const parentId = currentProject.parentId;
            if (parentId) {
              const parentIndex = items.findIndex(
                (item) => item.id === parentId
              );
              if (parentIndex !== -1) {
                setFocusedIndex(parentIndex);
                setSelectedProject(items[parentIndex]);
                scrollToKeepGap({
                  container: listRef,
                  target: listRef.querySelector('.focused') as HTMLElement,
                  align: 'top',
                });
                return true;
              }
            }
          }
        }
        return false;
      },
      runWithInputFocused: true,
    });
  });

  // Build project tree structure
  const projectTree = createMemo(() => {
    const allProjects = projects();
    const itemMap: { [key: string]: { item: any; children: any[] } } = {};
    const rootItems: { item: any; children: any[] }[] = [];
    const processedItems = new Set<string>();

    // First pass: Create a map of all items
    allProjects.forEach((item) => {
      itemMap[item.id] = { item, children: [] };
    });

    // Second pass: Connect children to parents
    allProjects.forEach((item) => {
      const parentId = item.parentId;
      if (parentId && itemMap[parentId]) {
        itemMap[parentId].children.push(item);
        processedItems.add(item.id);
      }
    });

    // Third pass: Add only root items (those without parents)
    allProjects.forEach((item) => {
      if (!processedItems.has(item.id)) {
        rootItems.push(itemMap[item.id]);
      }
    });

    return { rootItems, itemMap };
  });

  // Helper function to build project path
  const getProjectPath = (project: Project): string => {
    const tree = projectTree();
    const path: string[] = [];
    let currentId = project.parentId;

    while (currentId && tree.itemMap[currentId]) {
      const parent = tree.itemMap[currentId].item;
      path.unshift(parent.name);
      currentId = parent.parentId;
    }

    return path.length > 0 ? `/${path.join('/')}` : '';
  };

  // Flatten tree for display (only show expanded items)
  const [flattenedProjects, setFlattenedProjects] = createStore<{
    items: (Project & { depth: number; path?: string })[];
  }>({
    items: [],
  });

  // Update flattened projects when dependencies change
  const updateFlattenedProjects = () => {
    const query = searchQuery().toLowerCase();

    if (query) {
      // If searching, show flat list with paths
      const searchResults = projects()
        .filter((project) => project.name.toLowerCase().includes(query))
        .map((project) => ({
          ...project,
          depth: 0,
          path: getProjectPath(project),
        }));
      setFlattenedProjects('items', reconcile(searchResults));
    } else {
      // If not searching, show tree structure
      const result: (Project & { depth: number; path?: string })[] = [];
      const expanded = expandedProjects();
      const tree = projectTree();

      const processItems = (
        items: { item: any; children: any[] }[],
        depth = 0
      ) => {
        for (const item of items) {
          result.push({
            ...item.item,
            depth,
            path: getProjectPath(item.item),
          });
          // Only show children if the parent is expanded
          if (expanded[item.item.id] && item.children.length > 0) {
            // Convert children to the expected format
            const childrenAsTreeItems = item.children.map((child) => ({
              item: child,
              children: tree.itemMap[child.id]?.children || [],
            }));
            processItems(childrenAsTreeItems, depth + 1);
          }
        }
      };

      processItems(tree.rootItems);
      setFlattenedProjects('items', reconcile(result));
    }
  };

  // Update when search query changes
  createEffect(() => {
    searchQuery();
    updateFlattenedProjects();
  });

  // Update when expanded projects change
  createEffect(() => {
    expandedProjects();
    updateFlattenedProjects();
  });

  // Update when projects change
  createEffect(() => {
    projects();
    updateFlattenedProjects();
  });

  // Reset focused index when list changes (but preserve focus on current project if possible)
  createEffect(() => {
    const items = flattenedProjects.items;
    if (items.length > 0) {
      const currentSelected = selectedProject();
      if (currentSelected) {
        // Try to find the currently selected project in the new list
        const currentIndex = items.findIndex(
          (item) => item.id === currentSelected.id
        );
        if (currentIndex !== -1) {
          setFocusedIndex(currentIndex);
          return; // Don't change selection, just update focus
        }
      }

      // Don't automatically set focus or selection - wait for user interaction
      // Only set focus if there's already a focused item to maintain
      const currentFocus = focusedIndex();
      if (currentFocus >= 0 && currentFocus < items.length) {
        // Keep existing focus if it's still valid
        return;
      }
    }
  });

  const toggleExpanded = (projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const finishEditing = async () => {
    const projectId = selectedProject()?.id;
    if (projectId && props.entity) {
      // Only allow moving supported entity types
      if (
        props.entity.type === 'document' ||
        props.entity.type === 'chat' ||
        props.entity.type === 'project'
      ) {
        // Find the project name for the toast message
        const projectName = selectedProject()?.name || 'Unknown Project';

        await moveToProjectMutation.mutateAsync({
          entity: props.entity,
          project: { id: projectId, name: projectName },
        });
      }
    }
    props.onFinish();
  };

  const getIcon = createMemo(() => {
    switch (props.entity.type) {
      case 'channel':
        switch (props.entity.channelType) {
          case 'direct_message':
            return getIconConfig('directMessage');
          case 'organization':
            return getIconConfig('company');
          default:
            return getIconConfig('channel');
        }
      case 'document':
        return getIconConfig(props.entity.fileType || 'default');
      case 'chat':
        return getIconConfig('chat');
      case 'project':
        return getIconConfig('project');
      case 'email':
        return getIconConfig(props.entity.isRead ? 'emailRead' : 'email');
    }
  });

  return (
    <div class="" ref={rootScopeId} tabindex={-1}>
      <EntityModalTitle title="Move to folder" />
      <div class="flex pb-2">
        <div class="flex justify-between items-center gap-2">
          <div class="flex items-center gap-1">
            <div class="size-5 flex items-center justify-center">
              <Dynamic
                component={getIcon().icon}
                class={`flex size-full ${getIcon().foreground}`}
              />
            </div>

            {/* Project name */}
            <span class="shrink-0 text-ink text-sm sm:text-sm font-medium focus:font-bold font-sans grow overflow-hidden truncate">
              {props.entity.name}
            </span>
          </div>
          <CustomEntityIcon icon={ArrowRight} size="sm" />
          <div class="flex gap-1 items-center">
            {/* Project icon */}
            <div
              class="size-6 flex items-center justify-center"
              classList={{
                'opacity-20': !selectedProject(),
              }}
            >
              <EntityIcon targetType="project" size="sm" />
            </div>

            <Show when={selectedProject()}>
              {/* Project name */}
              <span class="shrink-0 text-ink text-sm sm:text-sm font-medium focus:font-bold font-sans grow overflow-hidden truncate">
                {selectedProject()?.name}
              </span>
              <Show when={searchQuery()}>
                <span class="text-ink-extra-muted/80 text-xs truncate">
                  {getProjectPath(selectedProject()!)}
                </span>
              </Show>
            </Show>
          </div>
        </div>
      </div>

      <div class="w-full h-fit suppress-css-brackets mb-3">
        <input
          type="text"
          placeholder="Search projects..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          class="w-full p-2 text-sm border-1 border-edge/20 bg-menu text-ink placeholder:text-ink-placeholder focus:outline-none selection:bg-ink selection:text-panel"
        />
      </div>
      <div class="w-full max-h-64 h-[300px] overflow-hidden">
        <Fragment ref={listRef}>
          <VList data={flattenedProjects.items} class="[&>div]:overflow-clip">
            {(project, index) => {
              // Safety check
              if (!project || !project.id) {
                console.warn('Skipping invalid project:', project);
                return null;
              }

              const isSelected = () => selectedProject()?.id === project.id;
              const isFocused = () =>
                focusedIndex() !== -1 && index() === focusedIndex();
              const isExpanded = () => expandedProjects()[project.id] || false;
              const hasChildren = () => {
                const tree = projectTree();
                return tree.itemMap[project.id]?.children.length > 0;
              };

              return (
                <div
                  class="group flex flex-col px-2"
                  style="margin: 2px 0"
                  onClick={() => {
                    setFocusedIndex(index());
                    setSelectedProject(project);
                    scrollToKeepGap({
                      container: listRef,
                      target: listRef.querySelector('.focused') as HTMLElement,
                      align: 'top',
                    });
                  }}
                  classList={{
                    'bg-accent/10': isFocused() && !isSelected(),
                    focused: isFocused(),
                  }}
                >
                  <BozzyBracket
                    active={isSelected() || isFocused()}
                    class="flex h-5"
                  >
                    <div
                      class="w-full"
                      style={{
                        'padding-top': '6px',
                        'padding-bottom': '6px',
                      }}
                    >
                      <div
                        class="w-full flex gap-1.5 items-center ml-auto text-ink-extra-muted h-5"
                        style={{
                          height: '20px',
                        }}
                      >
                        {/* Indentation spacers */}
                        <ExplorerSpacer depth={project.depth} size="sm" />

                        {/* Expand/collapse caret */}
                        <div
                          class="flex items-center justify-center w-4 h-4 cursor-pointer hover:bg-edge/10 rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(project.id);
                          }}
                          classList={{
                            'opacity-20': !!searchQuery() || !hasChildren(),
                          }}
                        >
                          <CaretRight
                            class={`w-3 h-3 transition-transform duration-150 ${isExpanded() && !searchQuery() ? 'rotate-90' : ''}`}
                          />
                        </div>

                        {/* Project icon */}
                        <div class="size-6 flex items-center justify-center">
                          <EntityIcon targetType="project" size="sm" />
                        </div>

                        {/* Project name */}
                        <span class="shrink-0 text-ink text-sm sm:text-sm font-medium focus:font-bold font-sans overflow-hidden truncate">
                          {project.name}
                        </span>
                        <Show when={searchQuery()}>
                          <span class="text-ink-extra-muted/80 text-xs truncate">
                            {project.path || ''}
                          </span>
                        </Show>
                      </div>
                    </div>
                  </BozzyBracket>
                </div>
              );
            }}
          </VList>
        </Fragment>
      </div>

      <EntityModalActionFooter
        onCancel={props.onCancel}
        onConfirm={finishEditing}
        confirmText="Move"
        isDisabled={!selectedProject()?.id}
      />
    </div>
  );
};
