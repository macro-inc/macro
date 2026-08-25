import CaretRightIcon from '@phosphor/caret-right.svg';
import DriveIcon from '@phosphor/shipping-container.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import { useUserId } from '@core/context/user';
import { useProjectsQuery } from '@queries/storage/projects';
import type { Project } from '@service-storage/generated/schemas/project';
import { makePersisted } from '@solid-primitives/storage';
import { cn } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';

type DriveTreeNode = {
  project: Project;
  children: DriveTreeNode[];
};

function sortNodes(nodes: DriveTreeNode[]) {
  nodes.sort((a, b) =>
    a.project.name.localeCompare(b.project.name, undefined, {
      sensitivity: 'base',
    })
  );
  for (const node of nodes) sortNodes(node.children);
  return nodes;
}

/** Expandable hierarchy of projects and folders owned by the current user. */
export function ExperimentalDriveTreeSection(props: {
  active: boolean;
  activeProjectId?: string;
  onSelectRoot: () => void;
  onSelect: (project: Project) => void;
}) {
  const userId = useUserId();
  const projectsQuery = useProjectsQuery();
  const [sectionExpanded, setSectionExpanded] = makePersisted(
    createSignal(true),
    { name: 'experimental-v2-drive-tree-expanded' }
  );
  const [expandedProjectIds, setExpandedProjectIds] = createSignal(
    new Set<string>()
  );

  const tree = createMemo(() => {
    const currentUserId = userId();
    const projects = (projectsQuery.data ?? []).filter(
      (project) => !currentUserId || project.userId === currentUserId
    );
    const nodes = new Map<string, DriveTreeNode>();
    for (const project of projects) {
      nodes.set(project.id, { project, children: [] });
    }

    const roots: DriveTreeNode[] = [];
    for (const project of projects) {
      const node = nodes.get(project.id);
      if (!node) continue;
      const parent = project.parentId ? nodes.get(project.parentId) : undefined;
      if (parent && parent !== node) parent.children.push(node);
      else roots.push(node);
    }
    return sortNodes(roots);
  });

  const toggleProject = (projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const TreeNode = (nodeProps: {
    node: DriveTreeNode;
    depth: number;
  }): JSX.Element => {
    const hasChildren = () => nodeProps.node.children.length > 0;
    const expanded = () => expandedProjectIds().has(nodeProps.node.project.id);
    const active = () => props.activeProjectId === nodeProps.node.project.id;

    return (
      <li>
        <div
          class={cn(
            'flex h-9 min-w-0 items-center rounded-xl pr-2 text-sm transition-colors',
            active()
              ? 'bg-active text-ink'
              : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
          )}
          style={{
            'margin-left': `${nodeProps.depth * 14}px`,
            width: `calc(100% - ${nodeProps.depth * 14}px)`,
            'padding-left': '8px',
          }}
        >
          <Show
            when={hasChildren()}
            fallback={<span class="size-5 shrink-0" />}
          >
            <button
              type="button"
              class="flex size-5 shrink-0 items-center justify-center rounded outline-none hover:bg-ink/7 focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-label={`${expanded() ? 'Collapse' : 'Expand'} ${nodeProps.node.project.name}`}
              aria-expanded={expanded()}
              onClick={(event) => {
                event.stopPropagation();
                toggleProject(nodeProps.node.project.id);
              }}
            >
              <CaretRightIcon
                class={cn(
                  'size-3 transition-transform',
                  expanded() && 'rotate-90'
                )}
              />
            </button>
          </Show>
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 py-2 text-left outline-none focus-visible:underline"
            aria-current={active() ? 'page' : undefined}
            onClick={() => props.onSelect(nodeProps.node.project)}
          >
            <FolderIcon class="size-4 shrink-0" />
            <span class="truncate">{nodeProps.node.project.name}</span>
          </button>
        </div>
        <Show when={hasChildren() && expanded()}>
          <ul>
            <For each={nodeProps.node.children}>
              {(child) => (
                <TreeNode node={child} depth={nodeProps.depth + 1} />
              )}
            </For>
          </ul>
        </Show>
      </li>
    );
  };

  return (
    <section class="w-full">
      <div
        class={cn(
          'flex h-9 w-full items-center rounded-xl pl-3 pr-1.5 text-sm font-medium transition-colors',
          props.active
            ? 'bg-active text-ink'
            : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
        )}
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:underline"
          aria-current={props.active ? 'page' : undefined}
          onClick={props.onSelectRoot}
        >
          <DriveIcon class="size-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate">My Drive</span>
        </button>
        <button
          type="button"
          class="flex size-6 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-ink/7 focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label={`${sectionExpanded() ? 'Collapse' : 'Expand'} My Drive`}
          aria-expanded={sectionExpanded()}
          onClick={() => setSectionExpanded((expanded) => !expanded)}
        >
          <CaretRightIcon
            class={cn(
              'size-3 transition-transform',
              sectionExpanded() && 'rotate-90'
            )}
          />
        </button>
      </div>
      <Show when={sectionExpanded()}>
        <Show
          when={tree().length > 0}
          fallback={
            <p class="m-0 px-10 py-2 text-xs text-ink-extra-muted">
              {projectsQuery.isLoading ? 'Loading folders…' : 'No folders'}
            </p>
          }
        >
          <ul class="mt-1 flex flex-col gap-0.5">
            <For each={tree()}>
              {(node) => <TreeNode node={node} depth={0} />}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  );
}
