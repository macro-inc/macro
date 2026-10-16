import { AGENTS_TOUR } from '@app/features/agents-view/tour';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import TerminalIcon from '@phosphor/terminal-window.svg';
import { useCursorApiKeyStatusQuery } from '@queries/auth/cursor-api-key';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import { Button } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { type JSX, Show } from 'solid-js';
import { HarnessIcon } from '../integration-ui';
import { SettingsSurface } from '../primitives';

function SetupStrip(props: {
  icon: JSX.Element;
  title: string;
  /** What the action acts on, for its accessible name. */
  subject: string;
  description: string;
  status?: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <SettingsSurface class="flex items-center gap-3.5 py-3 pr-4 pl-3.5">
      <HarnessIcon>{props.icon}</HarnessIcon>
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-medium text-ink">{props.title}</h3>
        <p class="mt-0.5 text-xs text-ink-muted">{props.description}</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Show when={props.status}>
          {(status) => (
            <span class="inline-flex h-5 items-center whitespace-nowrap rounded-md bg-success-bg px-2 text-[11px]/none font-medium text-success">
              {status()}
            </span>
          )}
        </Show>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="text-ink"
          aria-label={`${props.action} ${props.subject}`}
          onClick={props.onAction}
        >
          {props.action}
        </Button>
      </div>
    </SettingsSurface>
  );
}

/** Where agents can run besides Macro: Cursor, and your own paired machines. */
export function AgentSetupStrips(props: {
  onCursor: () => void;
  onSetUpRuntime: () => void;
  onManageRuntimes: () => void;
}) {
  const cursorStatus = useCursorApiKeyStatusQuery();
  const harnesses = useHarnessesQuery();
  const cursorConnected = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const paired = () => (harnesses.isSuccess ? harnesses.data : []);
  const setup = tourTarget(AGENTS_TOUR.agentSetup);

  return (
    <section ref={setup} aria-label="Agent setup" class="flex flex-col gap-3">
      <Show
        when={cursorConnected()}
        fallback={
          <SetupStrip
            icon={<CursorIcon />}
            title="Connect Cursor"
            subject="Cursor"
            description="Use your Cursor subscription to run agents in Macro."
            action="Connect"
            onAction={props.onCursor}
          />
        }
      >
        <SetupStrip
          icon={<CursorIcon />}
          title="Cursor"
          subject="Cursor"
          description="Runs on your Cursor plan."
          status="Connected"
          action="Manage"
          onAction={props.onCursor}
        />
      </Show>
      <Show
        when={paired().length > 0}
        fallback={
          <SetupStrip
            icon={<TerminalIcon />}
            title="Bring your own agent"
            subject="your own agent"
            description="Pair Claude Code, Codex, or another local agent with macrod."
            action="Set up"
            onAction={props.onSetUpRuntime}
          />
        }
      >
        <SetupStrip
          icon={<TerminalIcon />}
          title="Bring your own agent"
          subject="paired runtimes"
          description={paired()
            .map((harness) => harness.name)
            .join(', ')}
          status="Paired"
          action="Manage"
          onAction={props.onManageRuntimes}
        />
      </Show>
    </section>
  );
}
