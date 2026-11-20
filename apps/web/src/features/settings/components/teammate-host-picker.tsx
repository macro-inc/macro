import { t } from '@app/lib/i18n';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import type { TeammateHost } from '@service-auth/team-agents';
import { Button } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import {
  hostEngineLabel,
  hostUnavailableReason,
  sortedHosts,
} from '../core/teammate-host';
import { ChoiceRow } from '../primitives';

/**
 * The inviter's own machines, one choice each. A machine that can't host an
 * agent is shown disabled with the reason, so the owner knows what to fix.
 */
export function TeammateHostPicker(props: {
  /** `undefined` while loading. */
  hosts: readonly TeammateHost[] | undefined;
  failed: boolean;
  onRetry: () => void;
  selected: string | undefined;
  onSelect: (harnessId: string) => void;
  disabled?: boolean;
}) {
  return (
    <Show
      when={props.hosts}
      fallback={
        <Show
          when={props.failed}
          fallback={
            <p role="status" class="text-sm text-ink-muted">
              {t('teammateHosts.loadingHosts')}
            </p>
          }
        >
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
        <fieldset class="flex min-w-0 flex-col gap-2">
          <legend class="sr-only">{t('teammateHosts.ownComputer')}</legend>
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
                  name="macro-teammate-host"
                  value={host.harnessId}
                  checked={props.selected === host.harnessId}
                  title={host.name}
                  description={
                    unavailable() ?? hostEngineLabel(host) ?? host.name
                  }
                  disabled={props.disabled || !!unavailable()}
                  onChange={() => props.onSelect(host.harnessId)}
                  aside={
                    <Show when={host.experimental}>
                      <span class="whitespace-nowrap text-xs font-medium text-ink-muted">
                        {t('teammateHosts.hostExperimental')}
                      </span>
                    </Show>
                  }
                />
              );
            }}
          </For>
          <p class="text-xs text-ink-muted">
            {t('teammateHosts.pairComputer')}
          </p>
        </fieldset>
      )}
    </Show>
  );
}

/**
 * What hosting on one's own machine means, shown before Invite: whoever
 * administers the machine can act as the agent, and the agent's network
 * reaches what the machine's does.
 */
export function TeammateTrustWarning(props: {
  host: string;
  name: string;
}): JSX.Element {
  return (
    <div
      role="note"
      class="flex items-start gap-3 rounded-lg border border-edge-muted p-3"
    >
      <WarningCircleIcon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
      <div class="flex min-w-0 flex-col gap-1">
        <p class="text-sm font-medium text-ink">
          {t('teammateHosts.trustTitle', {
            host: props.host,
            name: props.name,
          })}
        </p>
        <p class="text-xs text-ink-muted">
          {t('teammateHosts.trustBody', { host: props.host, name: props.name })}
        </p>
      </div>
    </div>
  );
}
