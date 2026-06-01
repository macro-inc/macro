import { DashboardAiInput } from '@app/component/dashboard/dashboard-chat-input';
import { PromptTemplatesSection } from '@app/component/dashboard/sections/prompt-templates';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import { useUserContext } from '@core/context/user';
import LogoIcon from '@icon/macro-logo.svg';
import { notificationIsRead } from '@notifications';
import BellIcon from '@phosphor/bell.svg';
import { Button } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';

export function Hero() {
  const user = useUserContext();
  const notificationSource = useGlobalNotificationSource();
  const [notificationsOpen, setNotificationsOpen] = createSignal(false);
  const chatEditor = buildChatEditor();
  const fillChatInput = (
    text: string,
    mode: 'replace' | 'append' = 'replace'
  ) => {
    if (mode === 'append') {
      const current = chatEditor.controls.getMarkdown().trimEnd();
      if (!current.includes(text)) {
        chatEditor.controls.setMarkdown(
          current ? `${current}\n\n${text}` : text
        );
      }
    } else {
      chatEditor.controls.setMarkdown(text);
    }
    chatEditor.controls.focus();
  };

  const firstName = createMemo(() => {
    const name = user.author();
    return name.includes('@') ? name.split('@')[0] : name.split(' ')[0];
  });

  const timeOfDay = createMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  });

  const greeting = createMemo(() => `Good ${timeOfDay()}`);

  const unreadNotifications = createMemo(() =>
    notificationSource
      .notifications()
      .filter(
        (notification) =>
          !notification.done && !notificationIsRead(notification)
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
  );

  return (
    <section class="relative py-8 sm:py-14">
      <div class="mx-auto flex max-w-3xl flex-col items-center gap-8">
        <div class="flex w-full items-center justify-between gap-3 sm:justify-center">
          <LogoIcon class="hidden @max-sm:hidden sm:size-6 text-accent sm:block" />
          <h1 class="relative min-w-0 text-balance text-2xl font-medium tracking-tight text-ink">
            {greeting()}, <span class="capitalize">{firstName()}</span>
          </h1>
          <Button
            variant="base"
            size="icon-md"
            class="relative shrink-0 rounded-lg bg-surface sm:hidden"
            aria-label="Notifications"
            onClick={() => setNotificationsOpen(true)}
          >
            <BellIcon class="size-4" />
            <Show when={unreadNotifications().length > 0}>
              <span class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] font-bold text-surface">
                {unreadNotifications().length > 99
                  ? '99+'
                  : unreadNotifications().length}
              </span>
            </Show>
          </Button>
        </div>

        <div class="flex flex-col gap-4 w-full text-left">
          <DashboardAiInput editor={chatEditor} />
          <div class="w-full flex items-center justify-between">
            <PromptTemplatesSection onSelect={fillChatInput} />
          </div>
        </div>
      </div>
    </section>
  );
}
