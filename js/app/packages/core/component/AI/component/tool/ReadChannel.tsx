import { useChannelName } from '@core/context/channels';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg';
import {
  addDays,
  isEqual,
  isSameDay,
  isSameYear,
  isToday,
  isValid,
  isYesterday,
  startOfDay,
  subMilliseconds,
} from 'date-fns';
import { match, P } from 'ts-pattern';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

function parseDate(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return isValid(date) ? date : undefined;
}

function formatDay(date: Date) {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';

  const now = new Date();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: isSameYear(date, now) ? undefined : 'numeric',
  });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDateTime(date: Date) {
  return `${formatDay(date)}, ${formatTime(date)}`;
}

function formatTimeRange(
  fromValue: string | null | undefined,
  toValue: string | null | undefined
) {
  const from = parseDate(fromValue);
  const to = parseDate(toValue);

  if (from && to) {
    if (isEqual(from, startOfDay(from)) && isEqual(to, startOfDay(to))) {
      if (isEqual(to, addDays(from, 1))) return formatDay(from);

      const inclusiveEnd = subMilliseconds(to, 1);
      return `${formatDay(from)} → ${formatDay(inclusiveEnd)}`;
    }

    if (isSameDay(from, to)) {
      return `${formatDay(from)}, ${formatTime(from)}–${formatTime(to)}`;
    }

    return `${formatDateTime(from)} → ${formatDateTime(to)}`;
  }

  if (from) return `after ${formatDateTime(from)}`;
  if (to) return `before ${formatDateTime(to)}`;
  return 'time range';
}

function formatReadChannelWindow(args: {
  windowType: 'latest' | 'timeRange' | 'aroundMessage' | 'page' | 'messages';
  from?: string | null;
  to?: string | null;
  direction?: 'older' | 'newer' | null;
}) {
  return match(args)
    .with(
      { windowType: 'timeRange' },
      ({ from, to }) => `filtered by activity ${formatTimeRange(from, to)}`
    )
    .with(
      { windowType: 'page', direction: P.union('older', 'newer') },
      ({ direction }) => `page ${direction}`
    )
    .with({ windowType: 'page' }, () => 'page')
    .with({ windowType: 'aroundMessage' }, () => 'around message')
    .with({ windowType: 'messages' }, () => 'specific messages')
    .with({ windowType: 'latest' }, () => 'latest')
    .exhaustive();
}

export const readChannelMessagesHandler = createToolRenderer({
  name: 'ReadChannelMessages',
  render: (ctx) => {
    const channelName = useChannelName(ctx.tool.data.channelId, 'Channel');
    const messageCount = () => ctx.response?.data.messages?.length ?? 0;
    const windowLabel = () =>
      formatReadChannelWindow({
        windowType:
          ctx.response?.data.window.windowType ?? ctx.tool.data.windowType,
        from: ctx.response?.data.window.from ?? ctx.tool.data.from,
        to: ctx.response?.data.window.to ?? ctx.tool.data.to,
        direction:
          ctx.response?.data.window.direction ?? ctx.tool.data.direction,
      });

    return (
      <BaseTool type="call" icon={EyeIcon} renderContext={ctx.renderContext}>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex min-w-0 items-center justify-between gap-3">
            <span>
              Read messages in <span class="text-accent">{channelName()}</span>
            </span>
            {ctx.response && (
              <span class="shrink-0 text-xs text-ink-extra-muted">
                {messageCount()} messages
              </span>
            )}
          </div>
          <div class="text-xs text-ink-placeholder">{windowLabel()}</div>
        </div>
      </BaseTool>
    );
  },
});

export const readChannelMessageContextHandler = createToolRenderer({
  name: 'ReadChannelMessageContext',
  render: (ctx) => {
    const channelName = useChannelName(ctx.tool.data.channelId, 'Channel');

    return (
      <BaseTool type="call" icon={EyeIcon} renderContext={ctx.renderContext}>
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>
            Read <span class="text-accent">{channelName()}</span> message
            context
          </span>
        </div>
      </BaseTool>
    );
  },
});

export const readChannelThreadHandler = createToolRenderer({
  name: 'ReadChannelThread',
  render: (ctx) => {
    const channelName = useChannelName(ctx.tool.data.channelId, 'Channel');
    const replyCount = () => ctx.response?.data.replies?.length ?? 0;

    return (
      <BaseTool type="call" icon={EyeIcon} renderContext={ctx.renderContext}>
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>
            Read <span class="text-accent">{channelName()}</span> thread
          </span>
          {ctx.response && (
            <span class="shrink-0 text-xs text-ink-extra-muted">
              {replyCount()} replies
            </span>
          )}
        </div>
      </BaseTool>
    );
  },
});
