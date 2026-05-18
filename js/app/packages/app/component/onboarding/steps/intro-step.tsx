import ArrowRightIcon from '@icon/arrow-right.svg';
import LogoIcon from '@macro-icons/macro-logo.svg';
import { AnimatedCallIcon } from '@macro-icons/wide/animating/call';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
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
    color: 'text-default',
    hoverBg: 'hover:bg-default/10',
    hoverBorder: 'hover:border-default/40',
    hoverIconBg: 'group-hover:bg-default/10',
    title: 'Channels',
    description: 'Team messaging with threads and file sharing.',
  },
  {
    icon: AnimatedCallIcon,
    color: 'text-default',
    hoverBg: 'hover:bg-default/10',
    hoverBorder: 'hover:border-default/40',
    hoverIconBg: 'group-hover:bg-default/10',
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
    <div class="flex flex-col items-center text-center gap-10 w-full">
      <div class="flex flex-col items-center gap-5">
        <LogoIcon class="size-12 text-accent" />
        <div class="flex flex-col gap-2">
          <h1 class="text-4xl font-semibold text-ink tracking-tight">
            Welcome to Macro
          </h1>
          <p class="text-sm text-ink-disabled">
            SOC 2 certified · your data is never used to train AI
          </p>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3 w-full">
        <For each={BLOCKS}>
          {(item) => (
            <div
              class={cn(
                'group flex-1 flex flex-col gap-2.5 p-4 rounded-sm border border-ink/10 text-left transition-colors',
                item.hoverBg,
                item.hoverBorder
              )}
            >
              <div class={cn('size-8 rounded-sm bg-hover/50 flex items-center justify-center transition-colors', item.hoverIconBg)}>
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

      <Button
        variant="base"
        size="lg"
        onClick={() => ctx.next()}
        class="px-8 bg-accent text-surface border-accent not-disabled:hover:bg-accent/90 not-disabled:hover:text-surface focus-visible:bg-accent focus-visible:text-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
      >
        Get started
        <ArrowRightIcon class="size-4" />
      </Button>
    </div>
  );
}
