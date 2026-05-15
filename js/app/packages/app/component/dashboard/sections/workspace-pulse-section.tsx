import { useSplitLayout } from '@app/component/split-layout/layout';
import { useHistoryQuery } from '@queries/history/history';
import { useUserNotificationsQuery } from '@queries/notification/user-notifications';
import { createMemo, Show } from 'solid-js';

export function WorkspacePulseSection() {
  const { openWithSplit } = useSplitLayout();
  const historyQuery = useHistoryQuery();
  const notificationsQuery = useUserNotificationsQuery({ limit: 50 });

  const stats = createMemo(() => {
    const history = historyQuery.data ?? [];
    const notifications = notificationsQuery.data ?? [];

    const chats = history.filter((h) => h.type === 'chat').length;
    const tasks = history.filter((h) => h.type === 'document' && h.subType?.type === 'task').length;
    const docs = history.filter((h) => h.type === 'document' && h.subType?.type !== 'task').length;
    const unread = notifications.filter((n) => !n.viewed_at).length;

    return { chats, tasks, docs, unread, total: chats + tasks + docs };
  });

  // Calculate relative sizes for the abstract shapes
  const sizes = createMemo(() => {
    const s = stats();
    const max = Math.max(s.chats, s.tasks, s.docs, 1);
    return {
      chats: 40 + (s.chats / max) * 60,
      tasks: 40 + (s.tasks / max) * 60,
      docs: 40 + (s.docs / max) * 60,
    };
  });

  return (
    <section>
      <h2 class="text-sm font-semibold text-ink mb-3">Workspace pulse</h2>

      <div
        class="relative h-36 rounded-xl overflow-hidden cursor-pointer"
        onClick={() => openWithSplit({ type: 'component', id: 'search' })}
      >
        {/* Background gradient */}
        <div
          class="absolute inset-0"
          style={{
            background: `linear-gradient(135deg,
              oklch(from var(--color-chat) l c h / 0.15) 0%,
              oklch(from var(--color-task) l c h / 0.15) 50%,
              oklch(from var(--color-note) l c h / 0.15) 100%)`
          }}
        />

        {/* Abstract floating shapes */}
        <div class="absolute inset-0">
          {/* Chat blob */}
          <div
            class="absolute bg-chat/60 rounded-full blur-sm"
            style={{
              width: `${sizes().chats}%`,
              height: `${sizes().chats}%`,
              left: '5%',
              top: '20%',
            }}
          />

          {/* Task blob */}
          <div
            class="absolute bg-task/60 rounded-full blur-sm"
            style={{
              width: `${sizes().tasks}%`,
              height: `${sizes().tasks}%`,
              left: '35%',
              top: '10%',
            }}
          />

          {/* Doc blob */}
          <div
            class="absolute bg-note/60 rounded-full blur-sm"
            style={{
              width: `${sizes().docs}%`,
              height: `${sizes().docs}%`,
              right: '10%',
              bottom: '15%',
            }}
          />
        </div>

        {/* Mesh overlay for texture */}
        <div
          class="absolute inset-0 opacity-30"
          style={{
            'background-image': `radial-gradient(circle at 20% 30%, var(--color-chat) 0%, transparent 50%),
                                 radial-gradient(circle at 60% 20%, var(--color-task) 0%, transparent 40%),
                                 radial-gradient(circle at 80% 70%, var(--color-note) 0%, transparent 45%)`
          }}
        />

        {/* Content overlay */}
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="text-center">
            <Show when={stats().total > 0} fallback={
              <p class="text-ink-muted text-sm">Your workspace is quiet</p>
            }>
              <p class="text-4xl font-bold text-ink">{stats().total}</p>
              <p class="text-ink-muted text-sm">items this week</p>
            </Show>
          </div>
        </div>

        {/* Subtle grid pattern */}
        <div
          class="absolute inset-0 opacity-5"
          style={{
            'background-image': `linear-gradient(var(--color-ink) 1px, transparent 1px),
                                 linear-gradient(90deg, var(--color-ink) 1px, transparent 1px)`,
            'background-size': '20px 20px'
          }}
        />
      </div>
    </section>
  );
}
