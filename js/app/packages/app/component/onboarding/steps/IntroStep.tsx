import LogoIcon from '@macro-icons/macro-logo.svg';
import ShieldCheckIcon from '@icon/regular/shield-check.svg';
import LightningIcon from '@icon/regular/lightning.svg';
import SquaresFourIcon from '@icon/regular/squares-four.svg';
import { Button } from '@ui';
import { For } from 'solid-js';
import { useOnboarding } from '../onboarding-context';

const HIGHLIGHTS = [
  {
    icon: SquaresFourIcon,
    title: 'Unified workspace',
    description: 'Email, docs, tasks, and chat in one place.',
  },
  {
    icon: LightningIcon,
    title: 'AI automations',
    description: 'Intelligent agents that handle work for you.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Secure by default',
    description:
      'SOC 2 certified. Your data is never used to train AI models.',
  },
];

export function IntroStep() {
  const ctx = useOnboarding();

  return (
    <div class="flex flex-col items-center justify-center text-center gap-8 w-full flex-1">
      <LogoIcon class="size-14 text-accent" />
      <div class="flex flex-col gap-2">
        <h1 class="text-3xl font-semibold text-ink">Welcome to Macro</h1>
        <p class="text-base text-ink-muted">
          A unified system for work — built for speed and focus.
        </p>
      </div>

      <div class="grid grid-cols-3 gap-3 w-full">
        <For each={HIGHLIGHTS}>
          {(item) => (
            <div class="flex flex-col gap-2 p-3 rounded-sm border border-edge-muted bg-hover/30 text-left">
              <div class="size-7 rounded-sm bg-accent-bg flex items-center justify-center">
                <item.icon class="size-4 text-accent" />
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-sm font-medium text-ink">{item.title}</span>
                <span class="text-xs text-ink-muted leading-relaxed">{item.description}</span>
              </div>
            </div>
          )}
        </For>
      </div>

      <Button
        variant="base"
        size="lg"
        onClick={() => ctx.next()}
        class="px-12 bg-accent text-surface border-accent not-disabled:hover:bg-accent/90 not-disabled:hover:text-surface"
      >
        Get started
      </Button>
    </div>
  );
}
