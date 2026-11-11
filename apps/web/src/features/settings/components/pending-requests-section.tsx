import { shareEntity } from '@app/features/access-requests/core/types';
import { createSharingSource } from '@app/features/access-requests/queries/source';
import { RuntimeAccessAction } from '@app/features/runtime-sharing/components/RuntimeAccessAction';
import type { PendingRequest } from '@app/features/runtime-sharing/core/pending-requests';
import { usePendingRuntimeRequests } from '@app/features/runtime-sharing/queries/pending-requests';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { OwnerLabel } from '@entity/owner/owner-display';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { SettingsCard } from '../primitives';
import { RuntimeName } from './connected-runtimes-section';

const ROW_CLASS =
  'flex items-start justify-between gap-4 px-4 py-3 @max-[480px]:flex-col @max-[480px]:gap-2';
const ACTIONS_CLASS =
  'flex shrink-0 flex-wrap items-center justify-end gap-1 @max-[480px]:justify-start @max-[480px]:pl-2';

/**
 * Access requests waiting on the viewer, above their machines: teammates
 * asking to use a machine the viewer owns, decided here as in its Share menu,
 * and the viewer's own requests, which they can take back. Hidden when none
 * wait.
 */
export function PendingRequestsSection() {
  const pending = usePendingRuntimeRequests();
  const count = () => pending().incoming.length + pending().outgoing.length;
  // Every query tick rebuilds the pending objects, so rows are keyed by
  // request id: a row keyed by object would remount on each refetch, refetch
  // its own state on mount, and replace its buttons under the pointer.
  const incomingIds = () => pending().incoming.map(({ request }) => request.id);
  const outgoingIds = () => pending().outgoing.map(({ request }) => request.id);
  const incoming = (id: string) =>
    pending().incoming.find(({ request }) => request.id === id);
  const outgoing = (id: string) =>
    pending().outgoing.find(({ request }) => request.id === id);
  return (
    <Show when={count() > 0}>
      <div data-pending-runtime-requests>
        <h2 class="mb-3 px-6 text-sm font-semibold text-ink">
          {t('runtimeSharing.pendingRequestsTitle')}
        </h2>
        <SettingsCard>
          <For each={incomingIds()}>
            {(id) => (
              <Show when={incoming(id)}>
                {(pending) => <IncomingRequestRow pending={pending()} />}
              </Show>
            )}
          </For>
          <For each={outgoingIds()}>
            {(id) => (
              <Show when={outgoing(id)}>
                {(pending) => <OutgoingRequestRow pending={pending()} />}
              </Show>
            )}
          </For>
        </SettingsCard>
      </div>
    </Show>
  );
}

function IncomingRequestRow(props: { pending: PendingRequest }) {
  const source = createSharingSource(
    () => shareEntity('harness', props.pending.harness.id),
    () => true
  );
  const decide = (approve: boolean) =>
    fireAndForget(
      source
        .resolve(
          props.pending.request,
          approve ? props.pending.request.requestedLevel : null
        )
        .catch(() => toast.failure(t('runtimeSharing.writeFailed'))),
      'runtime-sharing'
    );
  return (
    <div class={ROW_CLASS} data-pending-request="incoming">
      <div class="min-w-0 flex-1 text-sm text-ink">
        <span class="font-medium">
          <OwnerLabel
            ownerId={props.pending.request.requesterId}
            suppressClick
            showTooltip={false}
          />
        </span>{' '}
        {t('runtimeSharing.requestedToUseInline', {
          name: props.pending.harness.name,
        })}
        <Show when={props.pending.request.requestedByAgent}>
          <p class="mt-0.5 text-xs text-ink-extra-muted">
            {t('runtimeSharing.viaAgent')}
          </p>
        </Show>
      </div>
      <div class={ACTIONS_CLASS}>
        <Button
          variant="ghost"
          size="sm"
          disabled={source.busy()}
          onClick={() => decide(false)}
        >
          {t('runtimeSharing.deny')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={source.busy()}
          onClick={() => decide(true)}
        >
          {t('runtimeSharing.approve')}
        </Button>
      </div>
    </div>
  );
}

function OutgoingRequestRow(props: { pending: PendingRequest }) {
  const owner = () =>
    props.pending.harness.owner.type === 'user'
      ? props.pending.harness.owner.user_id
      : undefined;
  return (
    <div class={ROW_CLASS} data-pending-request="outgoing">
      <div class="min-w-0 flex-1">
        <RuntimeName harness={props.pending.harness} />
        <p class="mt-0.5 pl-4 text-xs text-ink-extra-muted">
          <Show when={owner()}>
            {(owner) => (
              <>
                <OwnerLabel
                  ownerId={owner()}
                  suppressClick
                  showTooltip={false}
                />
                {' · '}
              </>
            )}
          </Show>
          <span class="font-medium text-accent-ink">
            {t('runtimeSharing.yourAccess', {
              access: t('runtimeSharing.requested'),
            })}
          </span>
        </p>
      </div>
      <div class={ACTIONS_CLASS}>
        <RuntimeAccessAction harnessId={props.pending.harness.id} />
      </div>
    </div>
  );
}
