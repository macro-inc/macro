import { t } from '@app/lib/i18n';
import type { TeammateHost } from '@service-auth/team-agents';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import type { AgentHost } from '../core/team-agent-draft';
import {
  hostEngineLabel,
  hostEngineUnreachable,
  hostUnavailableReason,
  sortedHosts,
} from '../core/teammate-host';
import { ChoiceRow } from '../primitives';
import { AGENT_COMPUTER_CHOICE } from './invite-agent-form';
import { TeammateHostSkeleton } from './teammate-host-picker';

/**
 * The inviter's own machines as rows of the Invite form's computer choice:
 * the same radio group as the sizes. A machine that can't host an agent is
 * disabled with the reason, so the owner knows what to fix.
 */
export function AgentHostChoices(props: {
  /** `undefined` while loading. */
  hosts: readonly TeammateHost[] | undefined;
  failed: boolean;
  onRetry: () => void;
  selected: string | undefined;
  onSelect: (host: AgentHost) => void;
  disabled?: boolean;
}) {
  return (
    <Show
      when={props.hosts}
      fallback={
        <Show when={props.failed} fallback={<TeammateHostSkeleton />}>
          <div
            role="alert"
            class="flex flex-wrap items-center gap-2 text-sm text-ink-muted"
          >
            <span>{t('teammateHosts.hostsFailed')}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => props.onRetry()}
            >
              {t('teammateHosts.tryAgain')}
            </Button>
          </div>
        </Show>
      }
    >
      {(hosts) => (
        <div class="flex min-w-0 flex-col gap-2">
          <For
            each={sortedHosts(hosts())}
            fallback={
              <p class="text-sm text-ink-muted">{t('teammateHosts.noHosts')}</p>
            }
          >
            {(host) => {
              const unavailable = () => hostUnavailableReason(host);
              return (
                <ChoiceRow
                  name={AGENT_COMPUTER_CHOICE}
                  value={`host:${host.harnessId}`}
                  checked={props.selected === host.harnessId}
                  title={host.name}
                  description={unavailable() ?? hostEngineLabel(host)}
                  // While the choice is held, the picked row stays readable.
                  disabled={
                    (props.disabled && props.selected !== host.harnessId) ||
                    !!unavailable()
                  }
                  onChange={() =>
                    props.onSelect({
                      harnessId: host.harnessId,
                      name: host.name,
                    })
                  }
                  aside={
                    <>
                      <Show when={host.experimental}>
                        <span class="whitespace-nowrap text-xs font-medium text-ink-muted">
                          {t('teammateHosts.hostExperimental')}
                        </span>
                      </Show>
                      {/* Checked again by itself too; this asks now. */}
                      <Show when={hostEngineUnreachable(host)}>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={(event) => {
                            event.preventDefault();
                            props.onRetry();
                          }}
                        >
                          {t('teammateHosts.checkAgain')}
                        </Button>
                      </Show>
                    </>
                  }
                />
              );
            }}
          </For>
          <p class="text-xs text-ink-muted">
            {t('teammateHosts.pairComputer')}
          </p>
        </div>
      )}
    </Show>
  );
}
