import { EntityIcon } from '@core/component/EntityIcon';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import ChevronDown from '@icon/regular/caret-down.svg?component-solid';
import ChevronUp from '@icon/regular/caret-up.svg?component-solid';
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
  const [isExpanded, setIsExpanded] = createSignal(false);

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
    <div class="border border-edge rounded w-full">
      <Show
        when={props.items.length > 0}
        fallback={
          <div class="flex items-center justify-between w-full text-left p-2 hover:bg-hover transition-colors">
            No Results
          </div>
        }
      >
        <button
          class={`flex items-center justify-between w-full text-left p-2 hover:bg-hover transition-colors ${
            isExpanded() ? 'rounded-t border-b border-edge' : 'rounded'
          }`}
          onClick={() => setIsExpanded((e) => !e)}
        >
          <div class="flex items-center gap-2">
            <div class="text-sm font-medium text-ink">
              Found
              <span class="text-accent pr-1"> {results().length}</span>
              Items
            </div>
          </div>
          <div class="flex items-center gap-1 text-ink-muted">
            <Show
              when={isExpanded()}
              fallback={<ChevronDown class="w-4 h-4" />}
            >
              <ChevronUp class="w-4 h-4" />
            </Show>
          </div>
        </button>
      </Show>

      <Show when={isExpanded()}>
        <div class="max-h-[480px] overflow-hidden">
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
      </Show>
    </div>
  );
};

const handler = createToolRenderer({
  name: 'ListEntities',
  renderCall: (ctx) => (
    <BaseTool icon={List} renderContext={ctx.renderContext} type="call">
      Filter for{' '}
      <span class="text-accent">
        {ctx.tool.data.includeTypes
          ? ctx.tool.data.includeTypes.join(', ')
          : 'All'}
      </span>{' '}
      ordered by{' '}
      <span class="text-accent">
        {ctx.tool.data.sortBy.split('_').join(' ')}
      </span>
    </BaseTool>
  ),
  renderResponse: (ctx) => (
    <BaseTool renderContext={ctx.renderContext} type="response">
      <ListEntitiesToolResponse
        items={ctx.toolResponse.tool.data.items}
        summary={ctx.toolResponse.tool.data.summary}
      />
    </BaseTool>
  ),
});

export const listEntitiesHandler = handler;
