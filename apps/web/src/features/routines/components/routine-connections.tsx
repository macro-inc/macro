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
  const add = () => (
    <props.Picker
      apps={props.apps}
      onChange={props.onChange}
      variant="button"
    />
  );
  return (
    <Show
      when={props.apps.length}
      fallback={
        <Show
          when={props.agent}
          fallback={
            <RoutineSettingRow
              label="No connections added"
              description="Add an Ask AI step to give it apps."
            />
          }
        >
          <RoutineSettingRow label="No connections added">
            {add()}
          </RoutineSettingRow>
        </Show>
      }
    >
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
      <div class="flex justify-end border-t border-edge-divider px-6 py-3">
        {add()}
      </div>
    </Show>
  );
}
