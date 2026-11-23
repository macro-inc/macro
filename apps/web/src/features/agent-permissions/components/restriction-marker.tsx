import { t } from '@app/lib/i18n';
import RobotIcon from '@icon/system/regular/robot.svg';
import XIcon from '@icon/system/regular/x.svg';
import type { ToolPermissionRule } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { stateLabel } from './labels';

/**
 * A following agent's own restriction on a row ("Restricted by the agent:
 * Ask"): the stricter of it and what the agent follows applies. ✕ removes
 * it, for someone who may edit the agent.
 */
export function RestrictionMarker(props: {
  rule: ToolPermissionRule;
  /** "Read default", "Email: Read": what the restriction is on. */
  target: string;
  onRemove?: () => void;
}) {
  const text = () =>
    props.rule.viaAgent
      ? t('agentPermissions.restrictedByAgent', {
          state: stateLabel(props.rule.state),
        })
      : t('agentPermissions.restrictedHere', {
          state: stateLabel(props.rule.state),
        });

  return (
    <span class="inline-flex items-center gap-1 text-xs text-ink-muted">
      <Show when={props.rule.viaAgent}>
        <RobotIcon aria-hidden="true" class="size-3 shrink-0" />
      </Show>
      {text()}
      <Show when={props.onRemove}>
        {(onRemove) => (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('agentPermissions.removeRestriction', {
              target: props.target,
            })}
            tooltip={t('agentPermissions.removeRestriction', {
              target: props.target,
            })}
            onClick={() => onRemove()()}
          >
            <XIcon class="size-3 shrink-0 pointer-events-none" />
          </Button>
        )}
      </Show>
    </span>
  );
}
