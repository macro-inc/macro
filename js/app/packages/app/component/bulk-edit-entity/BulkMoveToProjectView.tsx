import { EntityIcon } from '@core/component/EntityIcon';
import { scrollToKeepGap } from '@core/util/scrollToKeepGap';
import { useProjectsQuery } from '@queries/storage/projects';
import type { Project } from '@service-storage/generated/schemas';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { createBulkMoveToProjectDssEntityMutation } from '@macro-entity';
import { type EntityData, InlineEntity } from '@entity';
import { Dialog } from '@kobalte/core/dialog';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';

type ProjectWithDepth = Project & { depth?: number; path?: string };

export const BulkMoveToProjectView = (props: {
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
}) => {
  let listRef!: HTMLDivElement;
  const bulkMoveToProjectMutation = createBulkMoveToProjectDssEntityMutation();
  const projectsQuery = useProjectsQuery();
  const projects = () => projectsQuery.data ?? [];
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedProject, setSelectedProject] =
    createSignal<ProjectWithDepth | null>(null);
  const [expandedProjects, setExpandedProjects] = createSignal<{
    [key: string]: boolean;
  }>({});
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [attachHotkeys, moveToProjectHotkeyScopeId] = useHotkeyDOMScope(
    'bulk-move-to-project',
    true
  );
  let rootScopeId!: HTMLDivElement;

  onMount(() => {
    attachHotkeys(rootScopeId);
    registerHotkey({
      hotkey: ['arrowdown', 'ctrl+j'],
      scopeId: moveToProjectHotkeyScopeId,
      description: 'Down',
      keyDownHandler: () => {
        const items = flattenedProjects().items;
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
      hotkey: ['arrowup', 'ctrl+k'],
      scopeId: moveToProjectHotkeyScopeId,
      description: 'Up',
      keyDownHandler: () => {
        const items = flattenedProjects().items;
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
        const items = flattenedProjects().items;
        const currentIndex = focusedIndex();
        if (currentIndex === -1) return false;
        const currentProject = items[currentIndex];

        if (currentProject && !searchQuery()) {
          const tree = projectTree();
          const hasChildren =
            tree.itemMap[currentProject.id]?.children &&
            tree.itemMap[currentProject.id].children!.length > 0;
          const isExpanded = expandedProjects()[currentProject.id];

          if (hasChildren && !isExpanded) {
            // Expand current project
            setExpandedProjects((prev) => ({
              ...prev,
              [currentProject.id]: true,
            }));
            return true;
          } else if (hasChildren && isExpanded) {
            // Move to first child
            const children = tree.itemMap[currentProject.id].children!;
            const firstChild = children[0];
            const firstChildIndex = items.findIndex(
              (item: Project) => item.id === firstChild.id
            );
            if (firstChildIndex !== -1) {
              setFocusedIndex(firstChildIndex);
              setSelectedProject(firstChild);
              scrollToKeepGap({
                container: listRef,
                target: listRef.querySelector('.focused') as HTMLElement,
                align: 'bottom',
              });
            }
            return true;
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
        const items = flattenedProjects().items;
        const currentIndex = focusedIndex();
        if (currentIndex === -1) return false;
        const currentProject = items[currentIndex];

        if (currentProject && !searchQuery()) {
          const isExpanded = expandedProjects()[currentProject.id];

          if (isExpanded) {
            // Collapse current project
            setExpandedProjects((prev) => ({
              ...prev,
              [currentProject.id]: false,
            }));
            return true;
          } else {
            // Move to parent
            const parentId = currentProject.parentId;
            if (parentId) {
              const parentIndex = items.findIndex(
                (item: Project) => item.id === parentId
              );
              if (parentIndex !== -1) {
                setFocusedIndex(parentIndex);
                setSelectedProject(items[parentIndex]);
                scrollToKeepGap({
                  container: listRef,
                  target: listRef.querySelector('.focused') as HTMLElement,
                  align: 'top',
                });
              }
            }
            return true;
          }
        }
        return false;
      },
      runWithInputFocused: true,
    });
  });

  const projectTree = createMemo(() => {
    const allProjects = projects();
    const itemMap: Record<string, Project & { children?: Project[] }> = {};
    const rootItems: Project[] = [];
    // Build project tree structure

    // First pass: create item map and identify root items
    for (const project of allProjects) {
      itemMap[project.id] = { ...project, children: [] };
      if (!project.parentId) {
        rootItems.push(project);
      } else {
        // This will be processed in second pass
        const parentId = project.parentId;
        if (!itemMap[parentId]) {
          itemMap[parentId] = { ...project, children: [] };
        }
      }
    }

    // Second pass: build parent-child relationships
    for (const project of allProjects) {
      if (project.parentId && itemMap[project.parentId]) {
        itemMap[project.parentId].children!.push(project);
      }
    }

    return { itemMap, rootItems };
  });

  const getProjectPath = (projectId: string): string => {
    const tree = projectTree();
    const path: string[] = [];
    let currentId: string | undefined = projectId;
    while (currentId) {
      const project: Project & { children?: Project[] } =
        tree.itemMap[currentId];
      if (project) {
        path.unshift(project.name);
        currentId = project.parentId || undefined;
      } else {
        break;
      }
    }
    return path.join(' / ');
  };

  const [flattenedProjects, setFlattenedProjects] = createSignal<{
    items: ProjectWithDepth[];
  }>({ items: [] });

  const updateFlattenedProjects = () => {
    const query = searchQuery().toLowerCase();
    let newItems: ProjectWithDepth[];

    if (query) {
      // Search mode: filter projects that match the query
      const searchResults = projects()
        .filter((project: Project) =>
          project.name.toLowerCase().includes(query)
        )
        .map(
          (item: Project): ProjectWithDepth => ({
            ...item,
            depth: 0,
            path: getProjectPath(item.id),
          })
        );
      setFlattenedProjects({ items: searchResults });
      newItems = searchResults;
    } else {
      // Tree mode: flatten the hierarchy respecting expanded state
      const result: ProjectWithDepth[] = [];
      const expanded = expandedProjects();
      const tree = projectTree();

      const processItems = (
        items: Project[],
        depth: number = 0,
        path: string = ''
      ) => {
        for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
          const currentPath = path ? `${path} / ${item.name}` : item.name;
          result.push({ ...item, depth, path: currentPath });

          if (expanded[item.id] && tree.itemMap[item.id]?.children) {
            const childrenAsTreeItems = tree.itemMap[item.id].children!;
            processItems(childrenAsTreeItems, depth + 1, currentPath);
          }
        }
      };

      processItems(tree.rootItems);
      setFlattenedProjects({ items: result });
      newItems = result;
    }

    // Reset focus when items change — use newItems directly to avoid re-tracking
    const fi = untrack(focusedIndex);
    if (newItems.length > 0 && fi === -1) {
      setFocusedIndex(0);
      setSelectedProject(newItems[0]);
    } else if (fi >= newItems.length) {
      const newIndex = Math.max(0, newItems.length - 1);
      setFocusedIndex(newIndex);
      setSelectedProject(newItems[newIndex] || null);
    }
  };

  // Update flattened projects when dependencies change
  createEffect(() => {
    updateFlattenedProjects();
  });

  const items = () => flattenedProjects().items;

  const currentSelected = () => selectedProject();

  const currentIndex = () => {
    const selected = currentSelected();
    return selected ? items().findIndex((item) => item.id === selected.id) : -1;
  };

  // Keep focused index in sync with current selection
  createEffect(() => {
    const index = currentIndex();
    if (index !== -1 && index !== untrack(focusedIndex)) {
      setFocusedIndex(index);
    }
  });

  const toggleExpanded = (projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const finishEditing = async () => {
    const selected = selectedProject();
    if (selected) {
      try {
        const projectId = selected.id;
        const projectName = selected.name;

        await bulkMoveToProjectMutation.mutateAsync({
          entities: props.entities.map((entity) => ({
            ...entity,
            name: entity.name || entity.id,
          })),
          project: { id: projectId, name: projectName },
        });

        props.onFinish();
      } catch (error) {
        console.error('Failed to move entities to folder:', error);
        props.onError?.(error);
      }
    }
  };

  const entityCount = () => props.entities.length;
  const entityText = () => (entityCount() === 1 ? 'item' : 'items');

  return (
    <div ref={rootScopeId}>
      <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b-1 border-b-edge-muted h-[40px]">
        <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
          <CloseIcon />
        </Dialog.CloseButton>
        <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
          Move {entityCount()} {entityText()} to folder
        </Dialog.Title>
      </div>

      <div class="p-2 border-b border-edge-muted">
        <div class="flex items-center gap-2">
          <For each={props.entities.slice(0, 2)}>
            {(entity) => (
              <div
                class={cn('bg-edge/20 px-2 py-1 truncate text-xs rounded-xs', {
                  'max-w-[50%]': props.entities.length === 2,
                })}
              >
                <InlineEntity entity={entity} />
              </div>
            )}
          </For>
          <Show when={props.entities.length > 2}>
            <div class="text-muted-foreground text-xs px-2 py-1">
              +{props.entities.length - 2} more
            </div>
          </Show>
        </div>
      </div>

      <div class="p-3 flex flex-col gap-3">
        <div class="border border-edge-muted rounded-sm overflow-hidden">
          <input
            ref={(el) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => el.focus())
              );
            }}
            type="text"
            placeholder="Search folders..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              const isDown =
                e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j');
              const isUp = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k');
              if (isDown || isUp) {
                e.preventDefault();
                const itms = items();
                if (itms.length === 0) return;
                const fi = focusedIndex();
                const nextIndex = isDown
                  ? Math.min(fi + 1, itms.length - 1)
                  : Math.max(fi - 1, 0);
                setFocusedIndex(nextIndex);
                setSelectedProject(itms[nextIndex]);
                scrollToKeepGap({
                  container: listRef,
                  target: listRef.querySelector('.focused') as HTMLElement,
                  align: isDown ? 'bottom' : 'top',
                });
              } else if (e.key === 'Enter') {
                e.preventDefault();
                finishEditing();
              }
            }}
            class="w-full px-3 py-2 text-sm bg-menu text-ink focus:outline-none border-b border-edge-muted"
          />
          <div class="h-64 overflow-auto" ref={listRef}>
            <For each={items()}>
              {(project, index) => {
                const isSelected = () => currentSelected()?.id === project.id;
                const isFocused = () => focusedIndex() === index();
                const isExpanded = () => expandedProjects()[project.id];
                const hasChildren = () => {
                  const tree = projectTree();
                  return (
                    tree.itemMap[project.id]?.children &&
                    tree.itemMap[project.id].children!.length > 0
                  );
                };

                return (
                  <div
                    class={cn(
                      'flex items-center px-2 py-1 cursor-pointer hover:bg-accent/10',
                      isFocused() && 'focused bg-accent/20',
                      isSelected() && 'bg-accent/10'
                    )}
                    style={{
                      'padding-left': `${(project.depth || 0) * 16 + 8}px`,
                    }}
                    onClick={() => {
                      setSelectedProject(project);
                      setFocusedIndex(index());
                      scrollToKeepGap({
                        container: listRef,
                        target: listRef.querySelector(
                          '.focused'
                        ) as HTMLElement,
                        align: 'top',
                      });
                    }}
                  >
                    <div
                      class={cn(
                        'mr-2 w-4 h-4 flex items-center justify-center text-xs',
                        hasChildren() ? 'cursor-pointer' : 'opacity-20'
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasChildren()) {
                          toggleExpanded(project.id);
                        }
                      }}
                    >
                      {hasChildren() ? (isExpanded() ? '▼' : '▶') : ''}
                    </div>
                    <div class="mr-2">
                      {<EntityIcon targetType="project" />}
                    </div>
                    <div class="flex-1 text-sm truncate">{project.name}</div>
                    <Show when={searchQuery()}>
                      <div class="text-xs text-ink-placeholder ml-2 truncate max-w-48">
                        {getProjectPath(project.id)}
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" class="rounded-xs" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            class="rounded-xs"
            onClick={finishEditing}
            disabled={!selectedProject()}
          >
            Move
          </Button>
        </div>
      </div>
    </div>
  );
};
