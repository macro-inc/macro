import { t } from '@app/lib/i18n';
import XIcon from '@icon/system/regular/x.svg';
import type { ToolPermissionState } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { groupIcon } from './group-icon';
import { stateLabel } from './labels';
import { PermissionStateControl } from './permission-state-control';

/**
 * One entity's exception to an action's default: Allow · Ask · Never with
 * its saved state highlighted, and ✕ (`Use default (X)`), which removes the
 * exception (`null`). A new exception has no `state` until one is picked;
 * its ✕ cancels it.
 */
export function ExceptionRow(props: {
  group: string;
  name: string;
  /** "Contacts & CRM: Read", the control's accessible name. */
  label: string;
  state?: ToolPermissionState;
  defaultState: ToolPermissionState;
  editable: boolean;
  onSelect: (state: ToolPermissionState | null) => void;
}) {
  const Icon = groupIcon(props.group);
  const useDefault = () =>
    t('agentPermissions.useDefault', {
      state: stateLabel(props.defaultState),
    });

  return (
    <div class="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-1">
      <div class="flex min-w-0 flex-1 basis-36 items-center gap-3">
        <Icon aria-hidden="true" class="size-4 shrink-0 text-ink-muted" />
        <span class="min-w-0 truncate text-sm text-ink">{props.name}</span>
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-1 touch:w-full">
        <Show when={props.editable}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('agentPermissions.clearException', {
              entity: props.name,
              state: stateLabel(props.defaultState),
            })}
            tooltip={useDefault()}
            onClick={() => props.onSelect(null)}
          >
            <XIcon class="size-3.5 shrink-0 pointer-events-none" />
          </Button>
        </Show>
        <div class="touch:min-w-0 touch:flex-1">
          <PermissionStateControl
            label={props.label}
            value={props.state}
            disabled={!props.editable}
            onChange={props.onSelect}
          />
        </div>
      </div>
    </div>
  );
}
