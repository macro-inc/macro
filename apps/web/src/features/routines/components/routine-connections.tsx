import XIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { type Accessor, For, Show } from 'solid-js';
import type { RoutineEditorSlots } from '../context/routine-slots';
import type { RoutineApp } from '../core/draft';
import { RoutineSettingRow } from './routine-editor';

/**
 * The routine's required apps, one row each, and the button that adds them.
 * Only an Ask AI step uses them.
 */
export function ConnectionRows(props: {
  apps: RoutineApp[];
  /** Whether the routine has an Ask AI step to give apps to. */
  agent: boolean;
  connected: Accessor<ReadonlySet<string> | undefined>;
  onChange(apps: RoutineApp[]): void;
  Picker: RoutineEditorSlots['Apps'];
}) {
  return (
    <>
      <For each={props.apps}>
        {(app) => (
          <RoutineSettingRow
            label={app.server_name}
            description={
              props.connected() === undefined ? undefined : props
                  .connected()
                  ?.has(app.app_slug) ? (
                <span class="text-success">Connected</span>
              ) : (
                <span class="text-failure">
                  Not connected. Connect it before the routine runs.
                </span>
              )
            }
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${app.server_name}`}
              onClick={() =>
                props.onChange(
                  props.apps.filter((other) => other.app_slug !== app.app_slug)
                )
              }
            >
              <XIcon class="size-4" />
            </Button>
          </RoutineSettingRow>
        )}
      </For>
      {/* One row holds the picker whether or not apps are listed, so it stays
          mounted, and open, across picks. */}
      <div class="flex min-h-16 items-center gap-4 border-t border-edge-divider px-6 py-3 first:border-t-0 @max-[600px]/routine:px-4">
        <Show when={!props.apps.length}>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-base text-ink">No connections added</span>
            <Show when={!props.agent}>
              <span class="text-sm text-ink-muted">
                Add an Ask AI step to give it apps.
              </span>
            </Show>
          </div>
        </Show>
        <Show when={props.agent || props.apps.length}>
          <div class="ml-auto shrink-0">
            <props.Picker
              apps={props.apps}
              onChange={props.onChange}
              variant="button"
            />
          </div>
        </Show>
      </div>
    </>
  );
}
