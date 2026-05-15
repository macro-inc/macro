import { useSplitLayout } from '@app/component/split-layout/layout';
import { useHistoryQuery } from '@queries/history/history';
import { cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';

type ActivityType = 'chats' | 'tasks' | 'docs';

export function ActivityChartSection() {
  const { openWithSplit } = useSplitLayout();
  const historyQuery = useHistoryQuery();

  const totals = createMemo(() => {
    const history = historyQuery.data ?? [];
    return {
      chats: history.filter((h) => h.type === 'chat').length,
      tasks: history.filter((h) => h.type === 'document' && h.subType?.type === 'task').length,
      docs: history.filter((h) => h.type === 'document' && h.subType?.type !== 'task').length,
    };
  });

  const total = createMemo(() => {
    const t = totals();
    return t.chats + t.tasks + t.docs;
  });

  const handleClick = (type: ActivityType) => {
    if (type === 'chats') {
      openWithSplit({ type: 'component', id: 'agents' });
    } else if (type === 'tasks') {
      openWithSplit({ type: 'component', id: 'tasks' });
    } else {
      openWithSplit({ type: 'component', id: 'search' });
    }
  };

  const items = createMemo(() => {
    const t = totals();
    return [
      { type: 'chats' as ActivityType, label: 'Chats', count: t.chats, bg: 'bg-chat', text: 'text-chat' },
      { type: 'tasks' as ActivityType, label: 'Tasks', count: t.tasks, bg: 'bg-task', text: 'text-task' },
      { type: 'docs' as ActivityType, label: 'Docs', count: t.docs, bg: 'bg-note', text: 'text-note' },
    ].filter((item) => item.count > 0);
  });

  // Calculate sizes for overlapping circles (larger count = larger circle)
  const maxCount = createMemo(() => Math.max(totals().chats, totals().tasks, totals().docs, 1));

  return (
    <section>
      <h2 class="text-sm font-semibold text-ink mb-3">Recent activity</h2>

      <Show
        when={total() > 0}
        fallback={
          <div class="h-28 bg-ink/5 rounded-xl flex items-center justify-center">
            <span class="text-ink-muted text-sm">No recent activity</span>
          </div>
        }
      >
        {/* Overlapping circles */}
        <div class="relative h-28 flex items-center justify-center">
          <div class="flex items-center -space-x-8">
            <For each={items()}>
              {(item, i) => {
                const size = () => 60 + (item.count / maxCount()) * 50;
                return (
                  <button
                    type="button"
                    onClick={() => handleClick(item.type)}
                    class={cn(
                      item.bg,
                      'rounded-full flex flex-col items-center justify-center cursor-pointer',
                      'hover:scale-105 hover:z-10'
                    )}
                    style={{
                      width: `${size()}px`,
                      height: `${size()}px`,
                      'z-index': items().length - i(),
                    }}
                  >
                    <span class="text-surface font-bold text-lg">{item.count}</span>
                    <span class="text-surface/80 text-[10px] font-medium">{item.label}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </section>
  );
}
