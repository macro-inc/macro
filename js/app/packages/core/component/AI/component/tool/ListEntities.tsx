import { EntityIcon } from '@core/component/EntityIcon';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import CaretRight from '@phosphor/caret-right.svg?component-solid';
import List from '@phosphor-icons/core/regular/list.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { createMemo, createSignal, Show } from 'solid-js';
import { VList } from 'virtua/solid';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

type ListEntitiesItem = NamedTool<
  'ListEntities',
  'response'
>['data']['items'][number];

const ListEntitiesToolResponse = (props: {
  items: ListEntitiesItem[];
  summary: string;
}) => {
  const results = createMemo(() => {
    const seen = new Set<string>();
    return props.items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  });

  const getItemTitle = (item: ListEntitiesItem): string => {
    switch (item.type) {
      case 'document':
        return item.name || 'Document';
      case 'aiChat':
        return item.name || 'Chat';
      case 'project':
        return item.name || 'Project';
      case 'email':
        return item.subject || 'Email';
      case 'channel':
        return item.name || 'Channel';
      default:
        return 'Item';
    }
  };

  const getIconType = (item: ListEntitiesItem) => {
    switch (item.type) {
      case 'document':
        return 'default';
      case 'aiChat':
        return 'chat';
      case 'project':
        return 'project';
      case 'email':
        return 'email';
      case 'channel':
        return 'channel';
      default:
        return 'default';
    }
  };

  const { replaceOrInsertSplit } = useSplitLayout();

  const getClickHandler = (item: ListEntitiesItem) => {
    switch (item.type) {
      case 'document':
        return () => {
          replaceOrInsertSplit({ type: 'unknown', id: item.id });
        };
      case 'aiChat':
        return () => {
          replaceOrInsertSplit({ type: 'chat', id: item.id });
        };
      case 'project':
        return () => {
          replaceOrInsertSplit({ type: 'project', id: item.id });
        };
      case 'email':
        return () => {
          replaceOrInsertSplit({ type: 'email', id: item.id });
        };
      case 'channel':
        return () => {
          replaceOrInsertSplit({ type: 'channel', id: item.id });
        };
      default:
        return undefined;
    }
  };

  return (
    <div class="max-h-120 overflow-hidden">
      <VList
        data={results()}
        bufferSize={5 * 32}
        itemSize={32}
        style={{
          height: `${Math.min(results().length * 32, 480)}px`,
          contain: 'content',
        }}
      >
        {(item) => {
          const clickHandler = getClickHandler(item);

          return (
            <div
              class="flex items-center w-full h-8 px-2 hover:bg-hover transition-colors"
              onClick={clickHandler}
            >
              <div class="flex items-center flex-1 min-w-0 gap-2">
                <EntityIcon
                  size="sm"
                  targetType={getIconType(item)}
                  shared={false}
                />
                <div class="flex-1 min-w-0">
                  <TruncatedText size="sm">
                    <span>{getItemTitle(item)}</span>
                  </TruncatedText>
                </div>
              </div>
            </div>
          );
        }}
      </VList>
    </div>
  );
};

const handler = createToolRenderer({
  name: 'ListEntities',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const items = () => ctx.response?.data.items ?? [];
    const dedupedCount = () => {
      const seen = new Set<string>();
      let count = 0;

      for (const item of items()) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        count += 1;
      }

      return count;
    };
    const hasResults = () => dedupedCount() > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      if (dedupedCount() === 0) return 'No Results';
      if (dedupedCount() === 1) return '1 item';
      return `${dedupedCount()} items`;
    };

    return (
      <BaseTool
        icon={List}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <ListEntitiesToolResponse
              items={items()}
              summary={ctx.response?.data.summary ?? ''}
            />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span>
              Filter for{' '}
              <span class="text-accent">
                {ctx.tool.data.includeTypes
                  ? ctx.tool.data.includeTypes.join(', ')
                  : 'All'}
              </span>{' '}
              ordered by{' '}
              <span class="text-accent">
                {ctx.tool.data.sortBy?.split('_').join(' ') ?? 'default'}
              </span>
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Show when={statusText()}>
              {(text) => (
                <span class="text-xs text-ink-extra-muted">{text()}</span>
              )}
            </Show>
            <Show when={hasResults()}>
              <button
                type="button"
                class="shrink-0 text-ink-muted hover:text-ink p-1"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsExpanded((expanded) => !expanded);
                }}
              >
                <CaretRight
                  class="size-4 transition-transform"
                  classList={{
                    'rotate-90': isExpanded(),
                  }}
                />
              </button>
            </Show>
          </div>
        </div>
      </BaseTool>
    );
  },
});

export const listEntitiesHandler = handler;
