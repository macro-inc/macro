import { OwnerLabel } from '@entity/owner/owner-display';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { AccessLevelSelect } from '../components/AccessLevelSelect';
import type { SharingSource } from '../context/contracts';
import type { AccessLevel, AccessRequest } from '../core/types';

function ReviewRow(props: { request: AccessRequest; source: SharingSource }) {
  const [level, setLevel] = createSignal(props.request.requestedLevel);
  const resolve = async (granted: AccessLevel | null) => {
    try {
      await props.source.resolve(props.request, granted);
    } catch {
      /* Preserve the row; source reports the failure. */
    }
  };
  return (
    <div class="flex flex-wrap items-center justify-between gap-3 py-2">
      <div class="min-w-0">
        <OwnerLabel ownerId={props.request.requesterId} />
        <p class="text-xs text-ink-muted">
          Requested {props.request.requestedLevel} access ·{' '}
          {new Date(props.request.createdAt).toLocaleDateString()}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <AccessLevelSelect
          label="Access to grant"
          value={level()}
          levels={props.source.state()?.supportedLevels ?? []}
          onChange={setLevel}
          disabled={props.source.busy()}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={props.source.busy()}
          onClick={() => void resolve(level())}
        >
          Grant access
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.source.busy()}
          onClick={() => void resolve(null)}
        >
          Deny
        </Button>
      </div>
    </div>
  );
}

export function PermissionRequestsView(props: { source: SharingSource }) {
  return (
    <Show
      when={
        props.source.state()?.canReview &&
        (props.source.state()?.pendingCount ?? 0) > 0
      }
    >
      <section
        aria-label="Permission requests"
        class="border-b border-edge p-4 text-sm"
        data-permission-requests
      >
        <h3 class="font-medium mb-2">
          Permission requests ({props.source.state()?.pendingCount})
        </h3>
        <For each={props.source.state()?.requests.map((request) => request.id)}>
          {(id) => (
            <Show
              when={props.source
                .state()
                ?.requests.find((request) => request.id === id)}
            >
              {(request) => (
                <ReviewRow request={request()} source={props.source} />
              )}
            </Show>
          )}
        </For>
        <Show
          when={
            (props.source.state()?.pendingCount ?? 0) >
            (props.source.state()?.requests.length ?? 0)
          }
        >
          <div class="flex gap-2">
            <Button variant="ghost" size="sm" onClick={props.source.firstPage}>
              First page
            </Button>
            <Show when={props.source.state()?.nextOffset != null}>
              <Button variant="ghost" size="sm" onClick={props.source.nextPage}>
                More requests
              </Button>
            </Show>
          </div>
        </Show>
      </section>
    </Show>
  );
}
