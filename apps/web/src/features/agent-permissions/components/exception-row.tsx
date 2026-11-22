import { t } from '@app/lib/i18n';
import type { ToolPermissionState } from '@service-agent-harness/generated/schemas';
import { exceptionStates } from '../core/model';
import { groupIcon } from './group-icon';
import { stateLabel } from './labels';
import { PermissionStateMenu } from './permission-state-menu';

/**
 * One entity's exception to an action's default. Its menu offers the states
 * other than the default, its own state when that equals the default, and
 * "Use default (X)", which removes the exception (`null`). A new exception
 * has no `state` yet and shows "Choose permission".
 */
export function ExceptionRow(props: {
  group: string;
  name: string;
  /** "Contacts & CRM: Read", the menu's accessible name. */
  label: string;
  state?: ToolPermissionState;
  defaultState: ToolPermissionState;
  editable: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (state: ToolPermissionState | null) => void;
}) {
  const Icon = groupIcon(props.group);
  const options = () => [
    ...exceptionStates(props.defaultState, props.state).map((state) => ({
      state,
      label: stateLabel(state),
    })),
    {
      state: null,
      label: t('agentPermissions.useDefault', {
        state: stateLabel(props.defaultState),
      }),
    },
  ];

  return (
    <div class="flex min-h-12 items-center gap-3">
      <Icon aria-hidden="true" class="size-4 shrink-0 text-ink-muted" />
      <span class="min-w-0 flex-1 truncate text-sm text-ink">{props.name}</span>
      <PermissionStateMenu
        label={props.label}
        value={props.state}
        placeholder={t('agentPermissions.choosePermission')}
        options={options()}
        disabled={!props.editable}
        open={props.open}
        onOpenChange={props.onOpenChange}
        onSelect={props.onSelect}
      />
    </div>
  );
}
