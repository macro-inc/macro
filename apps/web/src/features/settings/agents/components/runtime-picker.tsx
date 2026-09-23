import AnthropicIcon from '@core/component/AI/assets/anthropic.svg';
import MacroLogo from '@icon/macro-logo.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import DesktopIcon from '@phosphor/desktop.svg';
import { For, Match, Show, Switch } from 'solid-js';
import { type AgentRuntime, runtimeSupportsTeam } from '../core/types';

export function RuntimePicker(props: {
  runtimes: readonly AgentRuntime[];
  selected: string;
  team: boolean;
  teamId?: string;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset class="flex flex-col gap-1.5">
      <legend class="sr-only">Runtime</legend>
      <For each={props.runtimes}>
        {(runtime) => {
          const disabled = () =>
            props.team && !runtimeSupportsTeam(runtime, props.teamId);
          return (
            <label class="flex items-center gap-3 rounded-lg border border-edge-muted px-3 py-2.5 has-checked:border-accent/50 has-checked:bg-accent/5 has-focus-visible:ring-2 has-focus-visible:ring-accent has-disabled:opacity-50">
              <input
                type="radio"
                name="agent-runtime"
                value={runtime.id}
                aria-label={runtime.name}
                checked={props.selected === runtime.id}
                disabled={disabled()}
                onChange={() => props.onChange(runtime.id)}
                class="size-3.5 shrink-0 accent-accent"
              />
              <span class="flex size-7 shrink-0 items-center justify-center text-ink-muted [&_svg]:size-4">
                <Switch fallback={<DesktopIcon />}>
                  <Match when={runtime.id === 'in-memory'}>
                    <MacroLogo />
                  </Match>
                  <Match when={runtime.id === 'cursor'}>
                    <CursorIcon />
                  </Match>
                  <Match when={runtime.id === 'claude-cloud'}>
                    <AnthropicIcon />
                  </Match>
                </Switch>
              </span>
              <span class="min-w-0 flex-1">
                <span class="block break-words text-sm font-medium text-ink">
                  {runtime.name}
                </span>
                <span class="block text-xs text-ink-muted">
                  {disabled()
                    ? 'Available for private agents'
                    : runtime.description}
                </span>
              </span>
              <Show when={runtime.kind === 'macrod'}>
                <span class="shrink-0 text-[11px] text-ink-muted">
                  {runtime.connected ? 'Online' : 'Offline'}
                </span>
              </Show>
            </label>
          );
        }}
      </For>
    </fieldset>
  );
}
