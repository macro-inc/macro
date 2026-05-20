import LogoIcon from '@icon/macro-logo.svg';
import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { A } from '@solidjs/router';
import { Button, cn } from '@ui';
import { For } from 'solid-js';
import { useOnboarding } from '../onboarding-context';

const BLOCKS = [
  {
    icon: AnimatedEmailIcon,
    color: 'text-email',
    hoverBg: 'hover:bg-email/10',
    hoverBorder: 'hover:border-email/40',
    hoverIconBg: 'group-hover:bg-email/10',
    title: 'Email',
    description: 'Full email client — no tab switching.',
  },
  {
    icon: AnimatedFileMdIcon,
    color: 'text-note',
    hoverBg: 'hover:bg-note/10',
    hoverBorder: 'hover:border-note/40',
    hoverIconBg: 'group-hover:bg-note/10',
    title: 'Docs',
    description: 'Markdown editor with mentions and live collaboration.',
  },
  {
    icon: AnimatedTaskIcon,
    color: 'text-task',
    hoverBg: 'hover:bg-task/10',
    hoverBorder: 'hover:border-task/40',
    hoverIconBg: 'group-hover:bg-task/10',
    title: 'Tasks',
    description: 'Assignments, due dates, and statuses — all linked.',
  },
  {
    icon: AnimatedChannelIcon,
    color: 'text-folder',
    hoverBg: 'hover:bg-folder/10',
    hoverBorder: 'hover:border-folder/40',
    hoverIconBg: 'group-hover:bg-folder/10',
    title: 'Channels',
    description: 'Team messaging with threads and file sharing.',
  },
  {
    icon: AnimatedCallIcon,
    color: 'text-calendar',
    hoverBg: 'hover:bg-calendar/10',
    hoverBorder: 'hover:border-calendar/40',
    hoverIconBg: 'group-hover:bg-calendar/10',
    title: 'Calls',
    description: 'Voice and video — no separate app needed.',
  },
  {
    icon: AnimatedStarIcon,
    color: 'text-chat',
    hoverBg: 'hover:bg-chat/10',
    hoverBorder: 'hover:border-chat/40',
    hoverIconBg: 'group-hover:bg-chat/10',
    title: 'AI Agents',
    description: 'Search, summarize, and act across everything.',
  },
];

export function IntroStep() {
  const ctx = useOnboarding();

  return (
    <div class="flex flex-col items-center text-center gap-10 w-full mobile:h-full">
      <div class="flex flex-col items-center gap-5">
        <LogoIcon class="size-12 text-accent" />
        <div class="flex flex-col gap-2">
          <h1 class="text-4xl mobile:text-2xl font-semibold text-ink tracking-tight">
            Welcome to Macro
          </h1>
          <p class="text-sm text-ink-disabled">
            SOC 2 certified · built for teams that move fast
          </p>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3 w-full mobile:grid-cols-1 mobile:gap-4 mobile:flex-1 mobile:min-h-0 mobile:overflow-y-auto mobile:scrollbar-hidden">
        <For each={BLOCKS}>
          {(item) => (
            <div
              class={cn(
                'group flex-1 flex flex-col gap-2.5 p-4 rounded-sm border border-edge-muted text-left transition-colors',
                'mobile:flex-row mobile:items-center mobile:gap-3 mobile:p-0 mobile:border-0 mobile:rounded-none',
                item.hoverBg,
                item.hoverBorder
              )}
            >
              <div
                class={cn(
                  'size-8 rounded-sm bg-ink/5 flex items-center justify-center transition-colors shrink-0',
                  item.hoverIconBg
                )}
              >
                <item.icon class={cn('size-5', item.color)} />
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-sm font-medium text-ink">{item.title}</span>
                <span class="text-xs text-ink-disabled leading-relaxed">
                  {item.description}
                </span>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="flex flex-col items-center gap-3 mobile:mt-auto mobile:w-full">
        <Button
          variant="base"
          size="lg"
          onClick={() => ctx.next()}
          class="px-8 mobile:w-full bg-accent text-surface border-accent not-disabled:hover:bg-accent/90 not-disabled:hover:text-surface focus-visible:bg-accent focus-visible:text-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
        >
          Get started
          <ArrowRightIcon class="size-4" />
        </Button>
        <p class="text-sm text-ink-disabled">
          Already have an account?{' '}
          <A
            href="/login"
            class="text-accent hover:text-accent/80 font-medium outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
          >
            Sign in
          </A>
        </p>
      </div>
    </div>
  );
}
