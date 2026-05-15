import LogoIcon from '@macro-icons/macro-logo.svg';
import ShieldCheckIcon from '@icon/regular/shield-check.svg';
import LightningIcon from '@icon/regular/lightning.svg';
import SquaresFourIcon from '@icon/regular/squares-four.svg';
import ArrowRightIcon from '@icon/regular/arrow-right.svg';
import { Button } from '@ui';
import { For } from 'solid-js';
import { useOnboarding } from '../onboarding-context';

const HIGHLIGHTS = [
  {
    icon: SquaresFourIcon,
    title: 'Unified workspace',
    description: 'Email, docs, tasks, and chat — all in one place.',
  },
  {
    icon: LightningIcon,
    title: 'AI automations',
    description: 'Intelligent agents that work alongside you.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Secure by default',
    description: 'SOC 2 certified. Your data stays yours.',
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
          <p class="text-base text-ink-disabled">
            The operating system for your startup — built for speed and focus.
          </p>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3 w-full">
        <For each={HIGHLIGHTS}>
          {(item) => (
            <div class="group flex flex-col gap-2.5 p-4 rounded-sm border border-ink/10 text-left transition-colors hover:bg-accent-bg hover:border-accent hover:text-accent">
              <div class="size-8 rounded-sm bg-accent-bg flex items-center justify-center">
                <item.icon class="size-4 text-accent" />
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
