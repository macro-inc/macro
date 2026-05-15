import { ChatWithAgentIcon } from '@app/component/ChatWithAgentButton';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { useUserContext } from '@core/context/user';
import EnvelopeIcon from '@icon/regular/envelope.svg';
import CheckCircleIcon from '@icon/regular/check-circle.svg';
import AtIcon from '@icon/regular/at.svg';
import CalendarIcon from '@icon/regular/calendar.svg';
import CommentIcon from '@icon/regular/chat-text.svg';
import { useUserNotificationsQuery } from '@queries/notification/user-notifications';
import {
  type SoupItemsQueryArgs,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { useHistoryQuery } from '@queries/history/history';
import {
  isTaskEntity,
  isTaskClosed,
  isCurrentUserAssigned,
} from '@entity';
import { cn } from '@ui';
import { createEffect, createMemo, createSignal, For, onMount, Show, type JSX } from 'solid-js';

interface StatItemProps {
  icon: JSX.Element;
  label: string;
  value: number;
  color: string;
  onClick: () => void;
  delay: number;
}

const compactFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatNumber(value: number): string {
  return compactFormatter.format(value);
}

function AnimatedCounter(props: { value: number; delay: number }) {
  const [displayValue, setDisplayValue] = createSignal(0);
  const [hasAnimated, setHasAnimated] = createSignal(false);

  createEffect(() => {
    const target = props.value;
    if (hasAnimated()) {
      setDisplayValue(target);
      return;
    }

    const timeout = setTimeout(() => {
      setHasAnimated(true);
      const duration = 600;
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayValue(Math.round(eased * target));

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);
    }, props.delay);

    return () => clearTimeout(timeout);
  });

  return <>{formatNumber(displayValue())}</>;
}

function StatItem(props: StatItemProps) {
  const [isVisible, setIsVisible] = createSignal(false);
  const isZero = () => props.value === 0;

  onMount(() => {
    const timeout = setTimeout(() => setIsVisible(true), props.delay * 0.5);
    return () => clearTimeout(timeout);
  });

  return (
    <button
      type="button"
      onClick={props.onClick}
      class={cn(
        'group flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl transition-all duration-300',
        'hover:bg-ink/5 active:scale-95',
        'opacity-0 translate-y-2',
        isVisible() && 'opacity-100 translate-y-0',
        isZero() && 'opacity-40'
      )}
      style={{ 'transition-delay': `${props.delay * 0.5}ms` }}
    >
      <div
        class={cn(
          'size-10 rounded-xl flex items-center justify-center transition-transform duration-200',
          'group-hover:scale-110',
          isZero() ? 'bg-ink/5 text-ink-muted' : props.color
        )}
      >
        <div class="size-5 [&_svg]:size-5">{props.icon}</div>
      </div>
      <div class="flex flex-col items-center">
        <span class={cn(
          'text-2xl font-semibold tabular-nums',
          isZero() ? 'text-ink-muted' : 'text-ink'
        )}>
          <AnimatedCounter value={props.value} delay={props.delay} />
        </span>
        <span class="text-xs text-ink-muted">{props.label}</span>
      </div>
    </button>
  );
}

export function StatsBar() {
  const { openWithSplit } = useSplitLayout();
  const user = useUserContext();

  const notificationsQuery = useUserNotificationsQuery({ limit: 100 });
  const unreadCount = createMemo(() => {
    const items = notificationsQuery.data ?? [];
    return items.filter((n) => !n.done && !n.viewed_at).length;
  });

  const mentionsCount = createMemo(() => {
    const items = notificationsQuery.data ?? [];
    return items.filter(
      (n) =>
        !n.viewed_at &&
        n.notification_metadata.tag.includes('mention')
    ).length;
  });

  const tasksArgs = createMemo(
    (): SoupItemsQueryArgs => ({
      params: {
        sort_method: 'updated_at',
        limit: 100,
      },
      body: {
        document_filters: {
          sub_types: ['task'],
        },
      },
    })
  );

  const tasksQuery = useSoupItemsQuery(tasksArgs, () => ({
    enabled: !!user.userId(),
  }));

  const openTasksCount = createMemo(() => {
    const data = tasksQuery.data ?? [];
    const userId = user.userId();

    return data
      .filter(isTaskEntity)
      .filter((task) => !isTaskClosed(task))
      .filter((task) => (userId ? isCurrentUserAssigned(task, userId) : true))
      .length;
  });

  const calendarEmailsArgs = createMemo(
    (): SoupItemsQueryArgs => ({
      params: {
        sort_method: 'updated_at',
        limit: 50,
      },
      body: {
        email_filters: {
          calendar_only: true,
        },
      },
    })
  );

  const calendarEmailsQuery = useSoupItemsQuery(calendarEmailsArgs, () => ({
    enabled: !!user.userId(),
  }));

  const meetingsCount = createMemo(() => {
    return calendarEmailsQuery.data?.length ?? 0;
  });

  const historyQuery = useHistoryQuery();

  const recentChatsCount = createMemo(() => {
    const items = historyQuery.data ?? [];
    return items.filter((item) => item.type === 'chat').length;
  });

  const commentsCount = createMemo(() => {
    const items = notificationsQuery.data ?? [];
    return items.filter(
      (n) =>
        !n.viewed_at &&
        n.notification_metadata.tag.includes('comment')
    ).length;
  });

  const stats = [
    {
      icon: <EnvelopeIcon />,
      label: 'Unread',
      getValue: unreadCount,
      color: 'bg-ink/10 text-ink-muted',
      onClick: () => openWithSplit({ type: 'component', id: 'inbox' }),
    },
    {
      icon: <CheckCircleIcon />,
      label: 'Open Tasks',
      getValue: openTasksCount,
      color: 'bg-task/10 text-task',
      onClick: () => openWithSplit({ type: 'component', id: 'tasks' }),
    },
    {
      icon: <AtIcon />,
      label: 'Mentions',
      getValue: mentionsCount,
      color: 'bg-ink/10 text-ink-muted',
      onClick: () => openWithSplit({ type: 'component', id: 'inbox' }),
    },
    {
      icon: <CommentIcon />,
      label: 'Comments',
      getValue: commentsCount,
      color: 'bg-comment/10 text-comment',
      onClick: () => openWithSplit({ type: 'component', id: 'inbox' }),
    },
    {
      icon: <ChatWithAgentIcon />,
      label: 'Chats',
      getValue: recentChatsCount,
      color: 'bg-chat/10 text-chat',
      onClick: () => openWithSplit({ type: 'component', id: 'agents' }),
    },
    {
      icon: <CalendarIcon />,
      label: 'Meetings',
      getValue: meetingsCount,
      color: 'bg-calendar/10 text-calendar',
      onClick: () => openWithSplit({ type: 'component', id: 'email' }),
    },
  ];

  return (
    <section class="flex flex-col gap-3">
      <h2 class="text-sm font-semibold text-ink">Since you last checked in</h2>
      <div class="flex flex-wrap items-center">
        <For each={stats}>
          {(stat, index) => (
            <>
              <Show when={index() > 0}>
                <div class="w-px h-12 bg-ink/10 mx-1 hidden sm:block" />
              </Show>
              <StatItem
                icon={stat.icon}
                label={stat.label}
                value={stat.getValue()}
                color={stat.color}
                onClick={stat.onClick}
                delay={index() * 60}
              />
            </>
          )}
        </For>
        {/* Placeholder */}
        <div class="w-px h-12 bg-ink/10 mx-1 hidden sm:block" />
        <div class="relative w-16 h-20 rounded-xl overflow-hidden ml-3">
          <div class="absolute inset-0 pattern-ink-muted pattern-diagonal-10 opacity-20" />
        </div>
      </div>
    </section>
  );
}
