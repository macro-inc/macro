import { useSplitLayout } from '@components/app/split-layout/layout';
import { EntityIcon } from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import FolderOpen from '@phosphor-icons/core/regular/folder-open.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal } from 'solid-js';
import { VList } from 'virtua/solid';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type ReadProjectItem = NamedTool<
  'ReadProject',
  'response'
>['data']['items'][number];

const ReadProjectToolResponse = (props: { items: ReadProjectItem[] }) => {
  const getItemIcon = (item: ReadProjectItem) => {
    switch (item.itemType) {
      case 'document':
        return (
          <EntityIcon
            targetType={fileTypeToBlockName(item.fileType, true)}
            size="xs"
            theme="monochrome"
          />
        );
      case 'chat':
        return <EntityIcon targetType="chat" size="xs" theme="monochrome" />;
      case 'project':
        return <EntityIcon targetType="project" size="xs" theme="monochrome" />;
      default:
        return undefined;
    }
  };

  const { replaceOrInsertSplit } = useSplitLayout();

  const getClickHandler = (item: ReadProjectItem) => {
    switch (item.itemType) {
      case 'document':
        return () => {
          replaceOrInsertSplit({
            type: fileTypeToBlockName(item.fileType),
            id: item.id,
          });
        };
      case 'chat':
        return () => {
          replaceOrInsertSplit({ type: 'chat', id: item.id });
        };
      case 'project':
        return () => {
          replaceOrInsertSplit({ type: 'project', id: item.id });
        };
      default:
        return undefined;
    }
  };

  const itemHeight = 32;
  const maxHeight = 240;

  return (
    <Tool.List>
      <VList
        class="overscroll-contain"
        data={props.items}
        bufferSize={itemHeight * 5}
        itemSize={itemHeight}
        style={{
          height: `${Math.min(props.items.length * itemHeight, maxHeight)}px`,
          contain: 'content',
        }}
      >
        {(item) => {
          const clickHandler = getClickHandler(item);

          return (
            <button
              type="button"
              class="block w-full text-left hover:bg-hover"
              onClick={clickHandler}
            >
              <Tool.ListItem icon={getItemIcon(item)}>
                <div class="truncate text-xs text-ink">{item.name}</div>
              </Tool.ListItem>
            </button>
          );
        }}
      </VList>
    </Tool.List>
  );
};

const handler = createToolRenderer({
  name: 'ReadProject',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const items = () => ctx.response?.data.items ?? [];
    const hasResults = () => items().length > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      if (items().length === 0) return 'Empty';
      if (items().length === 1) return '1 item';
      return `${items().length} items`;
    };

    return (
      <BaseTool
        icon={FolderOpen}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <ReadProjectToolResponse items={items()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <span class="min-w-0 truncate">
              Read folder{' '}
              <span class="text-ink">
                {ctx.response?.data.projectName ?? ctx.tool.data.projectId}
              </span>
            </span>
          </div>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasResults()}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});

export const readProjectHandler = handler;
