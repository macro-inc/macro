import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import type { JSX } from 'solid-js';

function SetupStep(props: {
  number: number;
  title: string;
  children: JSX.Element;
}) {
  return (
    <li class="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 pb-7 last:pb-0 before:absolute before:top-9 before:bottom-2 before:left-[13px] before:w-px before:bg-edge-muted last:before:hidden">
      <span
        aria-hidden="true"
        class="flex size-7 items-center justify-center rounded-full border border-edge-muted text-xs font-medium text-ink-muted"
      >
        {props.number}
      </span>
      <div class="min-w-0 pt-0.5">
        <h2 class="text-sm font-medium text-ink">{props.title}</h2>
        <div class="mt-2 flex flex-col gap-3 text-sm leading-relaxed text-ink-muted">
          {props.children}
        </div>
      </div>
    </li>
  );
}

/** Installation instructions surrounding the live pairing-code form. */
export function RuntimeSetupSteps(props: { children: JSX.Element }) {
  return (
    <ol aria-label="Runtime setup steps" class="list-none">
      <SetupStep number={1} title="Install macrod">
        <p>Download the macrod archive for your computer, then extract it.</p>
        <a
          href="https://github.com/macro-inc/macro/releases"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex w-fit items-center gap-1.5 rounded-lg border border-edge-muted px-3 py-2 text-xs font-medium text-ink hover:bg-ink/5 focus-visible:outline-accent"
        >
          Download macrod{' '}
          <ArrowUpRightIcon aria-hidden="true" class="size-3.5" />
        </a>
      </SetupStep>
      <SetupStep number={2} title="Run macrod">
        <p>Open a terminal in the extracted folder and run:</p>
        <div class="rounded-lg border border-edge-muted bg-ink/[0.025] px-3 py-2 font-mono text-sm text-ink">
          <span
            aria-hidden="true"
            class="mr-2 select-none text-ink-extra-muted"
          >
            $
          </span>
          <code>./macrod</code>
        </div>
        <p>
          Choose your agent, workspace, and access in Quickstart, then select{' '}
          <span class="font-medium text-ink">Create and pair</span>. Keep macrod
          running.
        </p>
      </SetupStep>
      <SetupStep number={3} title="Enter your pairing code">
        <p>
          Enter the device code from your terminal to review and connect this
          runtime.
        </p>
        {props.children}
      </SetupStep>
    </ol>
  );
}
