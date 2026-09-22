import LockIcon from '@phosphor/lock-key.svg';
import { For } from 'solid-js';

/** Shared security standards shown on the dedicated trust slide. */
export function SecurityBadges() {
  return (
    <div
      data-security-badges
      class="grid w-full grid-cols-3 gap-4 text-center sm:gap-8"
    >
      <For each={['ISO 27001', 'AICPA SOC', 'CASA Tier 2']}>
        {(name) => (
          <div class="flex flex-col items-center gap-4">
            <div class="glass flex size-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-surface),var(--color-ink)_8%)] sm:size-20">
              <LockIcon class="size-6 text-ink sm:size-7" />
            </div>
            <span class="whitespace-nowrap text-xs font-medium tracking-wide text-ink sm:text-sm">
              {name}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}
