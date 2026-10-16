import { useIsAuthenticated } from '@core/auth';
import Unauthorized from '@core/component/AccessErrorViews/Unauthorized';
import { Button } from '@ui';
import { type Accessor, createEffect, on, Show } from 'solid-js';
import type { SharingSource } from './context/contracts';
import { type ShareEntity, shareEntity } from './core/types';
import { createSharingSource } from './queries/source';
import { PermissionRequestsView } from './views/PermissionRequestsView';
import { RequestAccessView } from './views/RequestAccessView';

export { DirectAccessView } from './views/DirectAccessView';
export { PermissionRequestsView } from './views/PermissionRequestsView';
export { RequestAccessView } from './views/RequestAccessView';

/** Production adapter composition for the common Share dialog. */
export function useShareRequests(
  entity: Accessor<ShareEntity | undefined>,
  open: Accessor<boolean>
) {
  const authenticated = useIsAuthenticated();
  return createSharingSource(entity, () => !!authenticated() && open());
}
export function AccessRequestError(props: { source: SharingSource }) {
  return (
    <Show when={props.source.error()}>
      <div
        role="alert"
        class="flex items-center justify-between gap-2 rounded-xl bg-dialog px-4 py-2 text-sm text-ink-muted"
      >
        <span>{props.source.error()}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void props.source.refresh()}
        >
          Retry
        </Button>
      </div>
    </Show>
  );
}

/** Request initial access from a denied file route without loading its metadata. */
export function DocumentAccessDenied(props: {
  documentId: string;
  onAccessGranted: () => void;
}) {
  const authenticated = useIsAuthenticated();
  const source = useShareRequests(
    () => shareEntity('document', props.documentId),
    () => true
  );
  createEffect(
    on(
      () => source.state()?.accessLevel,
      (level) => {
        if (level) props.onAccessGranted();
      }
    )
  );
  return (
    <Unauthorized>
      <Show when={authenticated()}>
        <div class="mt-6 flex w-full flex-col gap-3 text-sm">
          <Show when={source.loading()}>
            <span class="text-ink-muted">Loading access requests…</span>
          </Show>
          <RequestAccessView
            source={source}
            allowedLevels={['view', 'comment', 'edit']}
          />
          <PermissionRequestsView source={source} />
          <AccessRequestError source={source} />
        </div>
      </Show>
    </Unauthorized>
  );
}

export { useSharedAccessUpdates } from './queries/access-updates';
