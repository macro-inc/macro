import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import PlugsIcon from '@phosphor/plugs-connected.svg';
import { Button } from '@ui';
import { For } from 'solid-js';
import styles from './macrod-promo.module.css';

const EXAMPLES = ['Claude Code', 'Codex', 'OpenCode', 'Hermes', 'OpenClaw'];

export function MacrodPromo(props: { onPair: () => void }) {
  return (
    <div class="rounded-xl border border-edge-muted bg-ink/[0.025] p-5">
      <div class="flex flex-wrap items-start gap-5">
        <div class="min-w-0 flex-1 basis-64">
          <h3 class="flex flex-wrap items-center gap-x-1 text-sm font-semibold leading-6 text-ink">
            <PlugsIcon class="mr-1 size-4 text-accent" />
            Bring your
            <span class="sr-only">own agents</span>
            <span aria-hidden="true" class={styles.examples}>
              <For each={EXAMPLES}>
                {(example, index) => (
                  <span
                    class="text-accent"
                    style={{ 'animation-delay': `${index() * 3}s` }}
                  >
                    {example}
                  </span>
                )}
              </For>
            </span>
            to Macro
          </h3>
          <p class="mt-2 text-xs leading-5 text-ink-muted">
            Your agent, running on your computer. Pair it with macrod, then use
            it in Macro with your local tools and projects.
          </p>
          <p class="mt-2 text-[11px] leading-4 text-ink-muted">
            Works with agents that support the Agent Client Protocol (ACP).
          </p>
        </div>
        <div class="flex min-w-40 flex-1 basis-40 flex-col gap-3">
          <Button type="button" variant="cta" size="sm" onClick={props.onPair}>
            <PlugsIcon class="size-3.5" />
            Pair a runtime
          </Button>
          <a
            href="https://docs.macro.com/AI/bring-your-own"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-1 text-xs text-ink-muted underline decoration-edge-muted underline-offset-4 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            Setup guide
            <ArrowUpRightIcon class="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
