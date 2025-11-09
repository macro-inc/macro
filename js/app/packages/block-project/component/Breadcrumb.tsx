import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { TextButton } from '@core/component/TextButton';
import { BarContext } from '@core/component/TopBar/Bar';
import FolderIcon from '@icon/fill/folder-fill.svg?component-solid';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { useHistoryTree } from '@service-storage/history';
import { useSearchParams } from '@solidjs/router';
import { createMemo, createSignal, For, Show, useContext } from 'solid-js';
import { projectSignal } from '../signal/project';

interface BreadcrumbProps {
  projectId: string;
}

interface Ancestor {
  id: string;
  name: string;
}

export function Breadcrumb(props: BreadcrumbProps) {
  const historyTree = useHistoryTree();
  const setProject = projectSignal.set;
  const [_searchParams, setSearchParams] = useSearchParams();
  const [showBreadcrumbMenu, setShowBreadcrumbMenu] = createSignal(false);
  const context = useContext(BarContext);
  if (!context) throw new Error('FileMenu must be used within a Bar');
  const truncation = context.truncation;

  const allAncestors = createMemo(() => {
    const ancestors: Ancestor[] = [];
    const itemMap = historyTree().itemMap;
    let currentId = props.projectId;

    while (currentId) {
      const currentItem = itemMap[currentId]?.item;
      if (!currentItem || currentItem.type !== 'project') break;

      if (currentItem.parentId) {
        const parent = itemMap[currentItem.parentId]?.item;
        if (parent && parent.type === 'project') {
          ancestors.unshift({
            id: parent.id,
            name: parent.name,
          });
        }
      }

      currentId = currentItem.parentId ?? '';
    }

    return ancestors;
  });

  const displayedAncestors = createMemo(() => {
    const ancestors = allAncestors();
    if (ancestors.length > 2 && !truncation().stage.hideBreadcrumb) {
      return [
        ancestors[0],
        { id: '...', name: '...' },
        ancestors[ancestors.length - 1],
      ];
    } else if (truncation().stage.hideBreadcrumb) {
      return [{ id: '...', name: '...' }];
    }
    return ancestors;
  });

  const elidedAncestors = createMemo(() => {
    const ancestors = allAncestors();
    if (ancestors.length > 2 && !truncation().stage.hideBreadcrumb) {
      return ancestors.slice(1, -1);
    } else if (truncation().stage.hideBreadcrumb) {
      return ancestors;
    }
    return [];
  });

  const handleClick = (id: string) => {
    const itemMap = historyTree().itemMap;
    const project = itemMap[id]?.item;
    if (project && project.type === 'project') {
      setProject(project);
    }
    setSearchParams({ projectId: project.id });
  };

  return (
    <Show when={displayedAncestors().length > 0}>
      <div class="flex items-center gap-1">
        <For each={displayedAncestors()}>
          {(ancestor, index) => (
            <>
              <Show when={index() > 0}>
                <span class="text-ink-extra-muted">/</span>
              </Show>
              <Show
                when={ancestor.id === '...'}
                fallback={
                  <TextButton
                    theme="clear"
                    onClick={() => handleClick(ancestor.id)}
                    class="text-sm text-ink-muted! hover:text-ink!"
                  >
                    {ancestor.name}
                  </TextButton>
                }
              >
                <DropdownMenu
                  open={showBreadcrumbMenu()}
                  onOpenChange={setShowBreadcrumbMenu}
                >
                  <DropdownMenu.Trigger>
                    <TextButton
                      theme="clear"
                      class="text-sm text-ink-muted! hover:text-ink!"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      {ancestor.name}
                    </TextButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenuContent>
                      <For each={elidedAncestors()}>
                        {(ancestor) => (
                          <MenuItem
                            icon={FolderIcon}
                            text={ancestor.name}
                            onClick={() => {
                              handleClick(ancestor.id);
                            }}
                          />
                        )}
                      </For>
                    </DropdownMenuContent>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </Show>
            </>
          )}
        </For>
        <span class="text-ink-extra-muted">/</span>
      </div>
    </Show>
  );
}
