import LogoIcon from '@macro-icons/macro-logo.svg';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
import { AnimatedFileMdIcon } from '@macro-icons/wide/animating/fileMd';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import { AnimatedChannelIcon } from '@macro-icons/wide/animating/channel';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { AnimatedCallIcon } from '@macro-icons/wide/animating/call';
import ArrowRightIcon from '@icon/regular/arrow-right.svg';
import { Button, cn } from '@ui';
import { For } from 'solid-js';
import { useOnboarding } from '../onboarding-context';

const BLOCKS = [
  {
    icon: AnimatedEmailIcon,
    color: 'text-email',
    title: 'Email',
    description: 'Full email client — no tab switching.',
  },
  {
    icon: AnimatedFileMdIcon,
    color: 'text-note',
    title: 'Docs',
    description: 'Markdown editor with mentions and live collaboration.',
  },
  {
    icon: AnimatedTaskIcon,
    color: 'text-task',
    title: 'Tasks',
    description: 'Assignments, due dates, and statuses — all linked.',
  },
  {
    icon: AnimatedChannelIcon,
    color: 'text-default',
    title: 'Channels',
    description: 'Team messaging with threads and file sharing.',
  },
  {
    icon: AnimatedCallIcon,
    color: 'text-default',
    title: 'Calls',
    description: 'Voice and video — no separate app needed.',
  },
  {
    icon: AnimatedStarIcon,
    color: 'text-chat',
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
            <div class="group flex-1 flex flex-col gap-2.5 p-4 rounded-sm border border-ink/10 text-left transition-colors hover:bg-accent-bg hover:border-accent hover:text-accent">
              <div class="size-8 rounded-sm bg-hover/50 flex items-center justify-center">
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
