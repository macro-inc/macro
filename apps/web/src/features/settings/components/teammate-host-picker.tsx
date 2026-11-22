import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import type { TeammateHost } from '@service-auth/team-agents';
import { Button } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import {
  hostEngineLabel,
  hostEngineUnreachable,
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
  /** Asks a machine whose engine didn't answer to check again now. */
  onRecheck: (harnessId: string) => void;
  selected: string | undefined;
  onSelect: (harnessId: string) => void;
  disabled?: boolean;
  /** What an empty list says; by default, that no computer can host yet. */
  empty?: string;
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
        <fieldset class="flex min-w-0 flex-col gap-2">
          <legend class="sr-only">{t('teammateHosts.ownComputer')}</legend>
          <For
            each={sortedHosts(hosts())}
            fallback={
              <p class="text-sm text-ink-muted">
                {props.empty ?? t('teammateHosts.noHosts')}
              </p>
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
                  description={unavailable() ?? hostEngineLabel(host)}
                  // While the choice is held, the picked row stays readable.
                  disabled={
                    (props.disabled && props.selected !== host.harnessId) ||
                    !!unavailable()
                  }
                  onChange={() => props.onSelect(host.harnessId)}
                  aside={
                    <>
                      <Show when={host.experimental}>
                        <span class="whitespace-nowrap text-xs font-medium text-ink-muted">
                          {t('teammateHosts.hostExperimental')}
                        </span>
                      </Show>
                      {/* Checked again by itself every 30 s; this asks the machine now. */}
                      <Show when={hostEngineUnreachable(host)}>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={(event) => {
                            event.preventDefault();
                            props.onRecheck(host.harnessId);
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
        </fieldset>
      )}
    </Show>
  );
}

/** Two machine rows, shimmering while the list loads. */
export function TeammateHostSkeleton() {
  return (
    <ListSkeleton.Root
      label={t('teammateHosts.loadingHosts')}
      class="flex min-w-0 flex-col gap-2"
    >
      <For each={[0, 1]}>
        {() => (
          <div class="flex items-start gap-3 rounded-lg border border-edge-muted p-3">
            <ListSkeleton.Bar class="mt-0.5 size-4 shrink-0" />
            <div class="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
              <ListSkeleton.Bar class="h-3 w-24" />
              <ListSkeleton.Bar class="h-2.5 w-32 max-w-full" />
            </div>
          </div>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/**
 * What hosting on one's own machine means, shown before Invite: whoever
 * administers the machine can act as the agent, and the agent's network
 * reaches what the machine's does.
 */
export function TeammateTrustWarning(props: {
  host: string;
  /** Empty until the agent is named. */
  name: string;
}): JSX.Element {
  return (
    <div
      role="note"
      class="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-bg p-3"
    >
      <WarningCircleIcon class="mt-0.5 size-4 shrink-0 text-warning" />
      <div class="flex min-w-0 flex-col gap-1">
        <p class="text-sm font-medium text-ink">
          {props.name
            ? t('teammateHosts.trustTitle', {
                host: props.host,
                name: props.name,
              })
            : t('teammateHosts.trustTitleUnnamed', { host: props.host })}
        </p>
        <p class="text-xs text-ink-muted">
          {t('teammateHosts.trustBody', { host: props.host })}
        </p>
      </div>
    </div>
  );
}
