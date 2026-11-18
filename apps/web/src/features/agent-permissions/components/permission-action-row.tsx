import { t } from '@app/lib/i18n';
import RobotIcon from '@icon/system/regular/robot.svg';
import type { ToolPermissionState } from '@service-agent-harness/generated/schemas';
import { Badge, Tooltip } from '@ui';
import { type JSX, Show } from 'solid-js';
import { PermissionRow } from './permission-row';
import { PermissionStateControl } from './permission-state-control';
import { PermissionStateGlyph } from './permission-state-glyph';

/** One of a group's five actions: its state for every tool in it. */
export function PermissionActionRow(props: {
  rowKey: string;
  name: JSX.Element;
  /** The control's accessible name, "Email: Send". */
  controlLabel: string;
  state: ToolPermissionState;
  tools: number;
  differs: number;
  /** The agent restricted this action itself; the tooltip says when. */
  agentHint?: string;
  sessionLimited?: boolean;
  disabled?: boolean;
  flash?: boolean;
  onChange: (state: ToolPermissionState) => void;
}) {
  return (
    <PermissionRow
      rowKey={props.rowKey}
      flash={props.flash}
      label={
        <span class="flex items-center gap-2 text-sm text-ink">
          <PermissionStateGlyph state={props.state} />
          {props.name}
        </span>
      }
      details={
        <>
          <span class="text-xs text-ink-extra-muted">
            <Show
              when={props.tools > 0}
              fallback={t('agentPermissions.noTools')}
            >
              {t('agentPermissions.toolCount', { count: props.tools })}
              <Show when={props.differs > 0}>
                {' · '}
                <span class="text-ink">
                  {t('agentPermissions.differCount', { count: props.differs })}
                </span>
              </Show>
            </Show>
          </span>
          <Show when={props.agentHint}>
            {(hint) => (
              <Tooltip label={hint()} as="span">
                <Badge size="xs" variant="ghost">
                  <RobotIcon aria-hidden="true" />
                  {t('agentPermissions.setByAgent')}
                </Badge>
              </Tooltip>
            )}
          </Show>
          <Show when={props.sessionLimited}>
            <Badge size="xs" variant="outline">
              {t('agentPermissions.thisSession')}
            </Badge>
          </Show>
        </>
      }
      controls={
        <PermissionStateControl
          label={props.controlLabel}
          value={props.state}
          disabled={props.disabled}
          onChange={props.onChange}
        />
      }
    />
  );
}
