import { isDesktopPlatform } from '@core/util/platform';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

/** One numbered step in a connection guide; steps share a connecting rail. */
export function SetupStep(props: {
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

/** An external link out of a setup step, e.g. to download or a dashboard. */
export function SetupLink(props: { href: string; children: JSX.Element }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex w-fit items-center gap-1.5 rounded-lg border border-edge-muted px-3 py-2 text-xs font-medium text-ink hover:bg-ink/5 focus-visible:outline-accent"
    >
      {props.children} <ArrowUpRightIcon aria-hidden="true" class="size-3.5" />
    </a>
  );
}

/** The bordered box around a guide's input, matching the pairing-code field. */
export function SetupField(props: { class?: string; children: JSX.Element }) {
  return (
    <div
      class={cn(
        'flex min-w-0 items-center gap-2 rounded-lg border border-edge-muted bg-ink/[0.025] px-3 py-2 transition-colors focus-within:border-accent',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

const INSTALL_SCRIPT_BASE =
  'https://raw.githubusercontent.com/macro-inc/macro/main/crates/coding_agent_worker/install';

/** A shell command to type, behind its prompt; long commands wrap. */
function SetupCommand(props: { prompt: string; command: string }) {
  return (
    <div class="flex gap-2 rounded-lg border border-edge-muted bg-ink/[0.025] px-3 py-2 font-mono text-sm text-ink">
      <span aria-hidden="true" class="select-none text-ink-extra-muted">
        {props.prompt}
      </span>
      <code class="min-w-0 [overflow-wrap:anywhere]">{props.command}</code>
    </div>
  );
}

/** Installation instructions surrounding the live pairing-code form. */
export function RuntimeSetupSteps(props: { children: JSX.Element }) {
  return (
    <>
      <Show when={isDesktopPlatform()}>
        <p class="mb-6 rounded-lg border border-edge-muted bg-ink/[0.025] px-3 py-2 text-sm text-ink-muted">
          Setting up this computer? The desktop app bundles the runtime — use
          the <span class="font-medium text-ink">This computer</span> card on
          the Runtimes page instead; no download or pairing code needed. The
          steps below connect a different machine.
        </p>
      </Show>
      <ol aria-label="Runtime setup steps" class="list-none">
        <SetupStep number={1} title="Install macrod">
          <p>On macOS or Linux, run in a terminal:</p>
          <SetupCommand
            prompt="$"
            command={`curl -fsSL ${INSTALL_SCRIPT_BASE}/install.sh | sh`}
          />
          <p>On Windows, run in PowerShell:</p>
          <SetupCommand
            prompt=">"
            command={`irm ${INSTALL_SCRIPT_BASE}/install.ps1 | iex`}
          />
          <p>Run it again later to update macrod.</p>
        </SetupStep>
        <SetupStep number={2} title="Run macrod">
          <p>
            Open a terminal in the folder where macrod should keep its
            configuration and run:
          </p>
          <SetupCommand prompt="$" command="macrod" />
          <p>
            Choose your agent, workspace, and access in Quickstart, then select{' '}
            <span class="font-medium text-ink">Create and pair</span>. Keep
            macrod running.
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
    </>
  );
}
