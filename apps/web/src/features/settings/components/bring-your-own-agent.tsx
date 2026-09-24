import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import TerminalIcon from '@phosphor/terminal-window.svg';
import { Button } from '@ui';
import { For } from 'solid-js';
import './bring-your-own-agent.css';

const AGENTS = ['Claude Code', 'OpenCode', 'OpenClaw', 'Hermes'];

/** A quiet, CSS-only word rotation; reduced motion shows a static invitation. */
export function BringYourOwnAgent(props: { onAddRuntime: () => void }) {
  return (
    <section class="byoa-card relative overflow-hidden rounded-xl border border-edge-muted bg-surface-2 p-6">
      <div class="mb-5 flex items-center gap-2 text-xs font-medium text-ink-muted">
        <TerminalIcon class="size-4" />
        Bring your own agent
      </div>
      <h2 class="text-xl font-medium tracking-tight text-ink">
        <span class="sr-only">Bring your agent to Macro</span>
        <span
          aria-hidden="true"
          class="flex flex-wrap items-baseline gap-x-1.5"
        >
          Bring
          <span class="byoa-word text-center text-accent">
            <For each={AGENTS}>
              {(agent, index) => (
                <span style={{ '--word-index': index() }}>{agent}</span>
              )}
            </For>
          </span>
          to Macro.
        </span>
      </h2>
      <p class="mt-3 max-w-lg text-sm leading-relaxed text-ink-muted">
        Your agent, on your machine. Connect a runtime with macrod, then give
        your agent instructions and a place in your workspace.
      </p>
      <div class="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={props.onAddRuntime}>
          <PlusIcon />
          New runtime
        </Button>
        <a
          href="https://docs.macro.com/AI/bring-your-own"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink focus-visible:outline-accent"
        >
          Setup guide <ArrowUpRightIcon class="size-3" />
        </a>
      </div>
    </section>
  );
}
