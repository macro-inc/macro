import { t } from '@app/lib/i18n';
import Warning from '@icon/system/regular/warning.svg';
import { cn } from '@ui';
import { Tooltip } from '@ui/components/Tooltip';
import { Show } from 'solid-js';
import { RuntimeAccessAction } from '../components/RuntimeAccessAction';
import type { AgentStop } from '../core/agent-stop';

/**
 * "Stopped: no access to <machine>", and for the agent's owner the way to ask
 * for it back. One line, for cards, the session pane and the DM header.
 */
export function AgentStoppedStatus(props: { stop: AgentStop; class?: string }) {
  return (
    <div
      class={cn('flex min-h-8 min-w-0 items-center gap-3', props.class)}
      data-agent-stopped
    >
      <Tooltip
        label={t('runtimeSharing.stoppedNoAccessHint')}
        as="span"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-failure"
      >
        <Warning aria-hidden="true" class="size-4 shrink-0" />
        <span class="min-w-0 truncate">
          {t('runtimeSharing.stoppedNoAccess', {
            name: props.stop.runtimeName,
          })}
        </span>
      </Tooltip>
      <Show when={props.stop.viewerOwnsAgent}>
        <RuntimeAccessAction harnessId={props.stop.harnessId} />
      </Show>
    </div>
  );
}
