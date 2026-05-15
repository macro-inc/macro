import LogoIcon from '@macro-icons/macro-logo.svg';
import ShieldCheckIcon from '@icon/regular/shield-check.svg';
import LightningIcon from '@icon/regular/lightning.svg';
import SquaresFourIcon from '@icon/regular/squares-four.svg';
import ArrowRightIcon from '@icon/regular/arrow-right.svg';
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
          <p class="text-base text-ink-muted">
            A unified system for work — built for speed and focus.
          </p>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3 w-full">
        <For each={HIGHLIGHTS}>
          {(item) => (
            <div class="group flex flex-col gap-2.5 p-4 rounded-sm border border-edge-muted text-left transition-colors hover:bg-accent-bg hover:border-accent hover:text-accent">
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

      <button
        type="button"
        onClick={() => ctx.next()}
        class="group flex items-center gap-2 px-8 py-3 text-sm font-medium rounded-sm bg-accent text-surface border border-accent hover:bg-accent/90 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        Get started
        <ArrowRightIcon class="size-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
  );
}
