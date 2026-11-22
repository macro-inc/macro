import { t } from '@app/lib/i18n';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import type { ToolPermissionState } from '@service-agent-harness/generated/schemas';
import { Badge, Button } from '@ui';
import { type JSX, Show } from 'solid-js';
import { PermissionRow } from './permission-row';
import { PermissionStateControl } from './permission-state-control';
import { PermissionStateGlyph } from './permission-state-glyph';

/** What a tool row says about how its state came about. */
export type ToolRowStatus =
  /** No setting of its own: its state is its action's, "follows Read". */
  | { kind: 'follows'; action: string }
  /** Its own rule, equal to its action's state today. */
  | { kind: 'own' }
  /** Its state differs from its action's. */
  | { kind: 'differs'; action: string; actionState: string };

/** One tool (SDK operation) in a group's custom view. */
export function PermissionToolRow(props: {
  rowKey: string;
  label: JSX.Element;
  /** `service.operation`. */
  operation: JSX.Element;
  /** The control's accessible name: the tool's label. */
  controlLabel: string;
  state: ToolPermissionState;
  status: ToolRowStatus;
  byAgent?: boolean;
  /** Clears the tool's own rule; present when it has one. */
  onClear?: () => void;
  /** "Use the Send setting". */
  clearLabel: string;
  disabled?: boolean;
  flash?: boolean;
  onChange: (state: ToolPermissionState) => void;
}) {
  const status = () => props.status;
  const differsText = () => {
    const value = status();
    if (value.kind !== 'differs') return undefined;
    return t('agentPermissions.toolDiffers', {
      action: value.action,
      state: value.actionState,
    });
  };
  const followsText = () => {
    const value = status();
    if (value.kind !== 'follows') return undefined;
    return t('agentPermissions.follows', { action: value.action });
  };
  return (
    <PermissionRow
      rowKey={props.rowKey}
      flash={props.flash}
      label={
        <span class="flex min-w-0 items-center gap-2 text-sm text-ink">
          <PermissionStateGlyph state={props.state} />
          <span class="min-w-0">{props.label}</span>
        </span>
      }
      details={
        <>
          <Show when={followsText()}>
            {(text) => <span class="text-xs text-ink-muted">{text()}</span>}
          </Show>
          <span class="min-w-0 truncate font-mono text-xs text-ink-extra-muted">
            {props.operation}
          </span>
          <Show when={differsText()}>
            {(text) => (
              <Badge size="xs" variant="outline">
                {text()}
              </Badge>
            )}
          </Show>
          <Show when={status().kind === 'own'}>
            <Badge size="xs" variant="outline">
              {t('agentPermissions.ownSetting')}
            </Badge>
          </Show>
          <Show when={props.byAgent}>
            <Badge size="xs" variant="ghost">
              <RobotIcon aria-hidden="true" />
              {t('agentPermissions.setByAgent')}
            </Badge>
          </Show>
        </>
      }
      controls={
        <>
          {/* Desktop keeps the empty slot so every control lines up; on
              touch the control is full width and the slot follows it. */}
          <span class="flex size-7 shrink-0 items-center justify-center touch:order-last touch:empty:hidden">
            <Show when={props.onClear}>
              {(onClear) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={props.clearLabel}
                  tooltip={props.clearLabel}
                  disabled={props.disabled}
                  onClick={() => onClear()()}
                >
                  <ArrowCounterClockwiseIcon class="size-4 shrink-0 pointer-events-none" />
                </Button>
              )}
            </Show>
          </span>
          <div class="min-w-0 flex-1">
            <PermissionStateControl
              label={props.controlLabel}
              value={props.state}
              disabled={props.disabled}
              onChange={props.onChange}
            />
          </div>
        </>
      }
    />
  );
}
