import { openCalendarEventSplit } from '@block-calendar/open-calendar-event';
import { getChannelParams } from '@channel/Channel/link';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { EntityIcon } from '@core/component/EntityIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import WideChannel from '@icon/wide-channel.svg';
import List from '@phosphor-icons/core/regular/list.svg';
import { createMemo, createSignal } from 'solid-js';
import { VList } from 'virtua/solid';
import { BaseTool } from './BaseTool';
import {
  collectSoupItems,
  documentBlockType,
  itemTitle,
  queryPreview,
  type SoupItem,
} from './QuerySoupItems';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

const QuerySoupToolResponse = (props: { items: SoupItem[] }) => {
  const { replaceOrInsertSplit } = useSplitLayout();

  const itemIcon = (item: SoupItem) => {
    switch (item.__typename) {
      case 'GraphqlSoupChannel':
      case 'GraphqlSoupChannelMessage':
        return <WideChannel class="size-4" />;
      case 'GraphqlSoupDocument':
        return (
          <EntityIcon
            targetType={fileTypeToBlockName(documentBlockType(item), true)}
            size="xs"
            theme="monochrome"
          />
        );
      case 'GraphqlSoupChat':
        return <EntityIcon targetType="chat" size="xs" theme="monochrome" />;
      case 'GraphqlSoupProject':
        return <EntityIcon targetType="project" size="xs" theme="monochrome" />;
      case 'GraphqlSoupEmailThread':
        return <EntityIcon targetType="email" size="xs" theme="monochrome" />;
      case 'GraphqlSoupCall':
        return <EntityIcon targetType="call" size="xs" theme="monochrome" />;
      case 'GraphqlSoupCalendarEvent':
        return (
          <EntityIcon targetType="calendar" size="xs" theme="monochrome" />
        );
      default:
        return undefined;
    }
  };

  const clickHandler = (item: SoupItem) => {
    switch (item.__typename) {
      case 'GraphqlSoupDocument':
        return () => {
          replaceOrInsertSplit({
            type: fileTypeToBlockName(documentBlockType(item)),
            id: item.id,
          });
        };
      case 'GraphqlSoupChat':
        return () => {
          replaceOrInsertSplit({ type: 'chat', id: item.id });
        };
      case 'GraphqlSoupProject':
        return () => {
          replaceOrInsertSplit({ type: 'project', id: item.id });
        };
      case 'GraphqlSoupEmailThread':
        return () => {
          replaceOrInsertSplit({ type: 'email', id: item.id });
        };
      case 'GraphqlSoupChannel':
        return () => {
          replaceOrInsertSplit({ type: 'channel', id: item.id });
        };
      case 'GraphqlSoupChannelMessage':
        return item.channelId
          ? () => {
              replaceOrInsertSplit({
                type: 'channel',
                id: item.channelId as string,
                params: getChannelParams(item.id),
              });
            }
          : undefined;
      case 'GraphqlSoupCall':
        return () => {
          replaceOrInsertSplit({ type: 'call', id: item.id });
        };
      case 'GraphqlSoupCalendarEvent':
        return () => {
          void openCalendarEventSplit({ eventId: item.id });
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
          const onClick = clickHandler(item);
          return (
            <button
              type="button"
              class="block w-full text-left hover:bg-hover"
              onClick={onClick}
            >
              <Tool.ListItem icon={itemIcon(item)}>
                <div class="truncate text-xs text-ink">{itemTitle(item)}</div>
              </Tool.ListItem>
            </button>
          );
        }}
      </VList>
    </Tool.List>
  );
};

const handler = createToolRenderer({
  name: 'QuerySoup',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const items = createMemo(() => collectSoupItems(ctx.response?.data));
    const hasResults = () => items().length > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      const count = items().length;
      if (count === 0) return 'No Results';
      return count === 1 ? '1 item' : `${count} items`;
    };

    return (
      <BaseTool
        icon={List}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <QuerySoupToolResponse items={items()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">
            Query workspace{' '}
            <span class="text-ink">{queryPreview(ctx.tool.data.query)}</span>
          </span>
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

export const querySoupHandler = handler;
