import { ChatWithAgentIcon } from '@app/component/ChatWithAgentButton';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { itemToBlockName, itemToSafeName } from '@core/constant/allBlocks';
import { useUserContext } from '@core/context/user';
import { formatRelativeDate } from '@core/util/time';
import ClockIcon from '@phosphor/clock.svg';
import FileIcon from '@phosphor/file.svg';
import FolderIcon from '@phosphor/folder.svg';
import UsersIcon from '@phosphor/users.svg';
import TaskIcon from '@icon/wide-task.svg';
import { type HistoryItem, useHistoryQuery } from '@queries/history/history';
import { useProjectsQuery } from '@queries/storage/projects';
import { formatDocumentName } from '@service-storage/util/filename';
import { cn } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

import {
  DashboardEmptyState,
  DashboardItemRow,
  DashboardSection,
} from '../dashboard-section';
import { DashboardSectionLoading } from '../dashboard-section-loading';

const RECENT_ITEMS_INITIAL = 12;
const RECENT_ITEMS_INCREMENT = 10;

type FilterType = 'all' | 'documents' | 'projects' | 'chats' | 'shared';

const FILTERS: { type: FilterType; label: string }[] = [
  { type: 'all', label: 'All' },
  { type: 'documents', label: 'Documents' },
  { type: 'projects', label: 'Projects' },
  { type: 'chats', label: 'Chats' },
  { type: 'shared', label: 'Shared' },
];

interface RecentItemsSectionProps {
  class?: string;
}

export function RecentItemsSection(props: RecentItemsSectionProps) {
  const [filter, setFilter] = createSignal<FilterType>('all');
  const [limit, setLimit] = createSignal(RECENT_ITEMS_INITIAL);

  const handleFilterChange = (type: FilterType) => {
    setFilter(type);
    setLimit(RECENT_ITEMS_INITIAL);
  };

  return (
    <DashboardSection
      title="Recent"
      icon={<ClockIcon />}
      class={props.class}
      fallback={<DashboardSectionLoading rows={RECENT_ITEMS_INITIAL} />}
    >
      <div class="flex items-center gap-1 mb-3 -mt-1">
        <For each={FILTERS}>
          {(f) => (
            <button
              type="button"
              onClick={() => handleFilterChange(f.type)}
              class={cn(
                'px-2.5 py-1 text-xs rounded-md transition-colors',
                filter() === f.type
                  ? 'bg-ink/10 text-ink font-medium'
                  : 'text-ink-muted hover:text-ink hover:bg-ink/5'
              )}
            >
              {f.label}
            </button>
          )}
        </For>
      </div>
      <RecentItemsContent
        filter={filter()}
        limit={limit()}
        onLoadMore={() => setLimit((l) => l + RECENT_ITEMS_INCREMENT)}
      />
    </DashboardSection>
  );
}

function getItemIconAndColor(item: HistoryItem): { icon: typeof FileIcon; bg: string } {
  if (item.type === 'chat') {
    return { icon: () => <ChatWithAgentIcon />, bg: 'bg-chat/10 text-chat' };
  }
  if (item.type === 'project') {
    return { icon: FolderIcon, bg: 'bg-project/10 text-project' };
  }
  if (item.type === 'document') {
    const subType = item.subType;
    if (subType?.type === 'task') {
      return { icon: TaskIcon, bg: 'bg-task/10 text-task' };
    }
    return { icon: FileIcon, bg: 'bg-note/10 text-note' };
  }
  return { icon: FileIcon, bg: 'bg-ink/5 text-ink-muted' };
}

function getItemName(item: HistoryItem): string {
  if (item.type === 'document') {
    const fileType = item.fileType ?? undefined;
    return formatDocumentName(
      itemToSafeName({
        name: item.rawName ?? item.name,
        type: item.type,
        fileType,
        subType: item.subType,
      }),
      fileType,
      { fullyQualifiedBlockName: true }
    );
  }
  return item.name;
}

type BlockType = 'md' | 'chat' | 'project';

type DisplayItem = {
  id: string;
  name: string;
  type: 'document' | 'chat' | 'project' | 'shared';
  updatedAt?: string | null;
  icon: typeof FileIcon;
  iconBg: string;
  blockType: BlockType;
};

function RecentItemsContent(props: {
  filter: FilterType;
  limit: number;
  onLoadMore: () => void;
}) {
  const user = useUserContext();
  const historyQuery = useHistoryQuery();
  const projectsQuery = useProjectsQuery();
  const { openWithSplit } = useSplitLayout();

  const toDateString = (date: Date | string | null | undefined): string | null => {
    if (!date) return null;
    if (typeof date === 'string') return date;
    return date.toISOString();
  };

  const sharedProjects = createMemo(() => {
    const projects = projectsQuery.data ?? [];
    const userId = user.userId();
    return projects
      .filter((project) => project.userId !== userId)
      .sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      })
      .map((project): DisplayItem => ({
        id: project.id,
        name: project.name || 'Untitled Project',
        type: 'shared',
        updatedAt: toDateString(project.updatedAt),
        icon: FolderIcon,
        iconBg: 'bg-project/10 text-project',
        blockType: 'project',
      }));
  });

  const historyItems = createMemo(() => {
    const items = historyQuery.data ?? [];
    return items.map((item): DisplayItem => {
      const { icon, bg } = getItemIconAndColor(item);
      const blockName = itemToBlockName(item);
      const blockType: BlockType =
        blockName === 'chat' ? 'chat' : blockName === 'project' ? 'project' : 'md';
      return {
        id: item.id,
        name: getItemName(item),
        type: item.type,
        updatedAt: toDateString(item.updatedAt),
        icon,
        iconBg: bg,
        blockType,
      };
    });
  });

  const filteredItems = createMemo(() => {
    if (props.filter === 'shared') {
      return sharedProjects();
    }
    const items = historyItems();
    if (props.filter === 'all') return items;
    if (props.filter === 'documents') return items.filter((i) => i.type === 'document');
    if (props.filter === 'projects') return items.filter((i) => i.type === 'project');
    if (props.filter === 'chats') return items.filter((i) => i.type === 'chat');
    return items;
  });

  const displayedItems = createMemo(() => filteredItems().slice(0, props.limit));
  const hasMore = createMemo(() => filteredItems().length > props.limit);

  const handleItemClick = (item: DisplayItem) => {
    openWithSplit({
      type: item.blockType,
      id: item.id,
    });
  };

  const EmptyIcon = () => (props.filter === 'shared' ? <UsersIcon /> : <ClockIcon />);
  const emptyTitle = () =>
    props.filter === 'shared' ? 'No shared items' : 'No recent items';
  const emptyDesc = () =>
    props.filter === 'shared'
      ? 'Items shared with you will appear here'
      : 'Items you view will appear here';

  return (
    <Show
      when={displayedItems().length > 0}
      fallback={
        <DashboardEmptyState
          icon={<EmptyIcon />}
          title={emptyTitle()}
          description={emptyDesc()}
        />
      }
    >
      <div class="flex flex-col max-h-[420px] overflow-y-auto -m-3">
        <For each={displayedItems()}>
          {(item) => {
            const Icon = item.icon;
            return (
              <DashboardItemRow
                icon={<Icon />}
                iconBg={item.iconBg}
                title={item.name}
                subtitle={
                  item.updatedAt ? formatRelativeDate(item.updatedAt) : undefined
                }
                onClick={() => handleItemClick(item)}
              />
            );
          }}
        </For>
        <Show when={hasMore()}>
          <button
            type="button"
            onClick={props.onLoadMore}
            class="mt-1 mb-3 mx-3 py-2 text-xs text-ink-muted bg-ink/5 hover:bg-ink/10 rounded-lg transition-colors"
          >
            Load more ({filteredItems().length - props.limit} remaining)
          </button>
        </Show>
      </div>
    </Show>
  );
}
