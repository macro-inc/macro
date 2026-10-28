import { Dialog } from '@kobalte/core/dialog';
import '@fontsource-variable/inter';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { Button } from '../../../src/components/ui';
import type { SharingSource } from '../../../src/features/access-requests/context/contracts';
import type {
  AccessLevel,
  AccessRequest,
} from '../../../src/features/access-requests/core/types';
import { DirectAccessView } from '../../../src/features/access-requests/views/DirectAccessView';
import { PermissionRequestsView } from '../../../src/features/access-requests/views/PermissionRequestsView';
import { RequestAccessView } from '../../../src/features/access-requests/views/RequestAccessView';
import { isTouchDevice } from '../../../src/lib/core/mobile/isTouchDevice';
import '../../../src/index.css';

// Real Share controls with an injected deterministic source. Authorization,
// persistence, race handling and grant propagation have PostgreSQL coverage.
function Fixture() {
  const params = new URLSearchParams(location.search);
  const [reviewing, setReviewing] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [request, setRequest] = createSignal<AccessRequest>();
  const [access, setAccess] = createSignal<AccessLevel | null>(
    params.has('no-access') ? null : 'view'
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [fail, setFail] = createSignal(false);
  const levels: AccessLevel[] = params.has('pdf')
    ? ['view', 'comment']
    : ['view', 'comment', 'edit'];
  const pending = () => request()?.status === 'pending';
  const source: SharingSource = {
    state: () => ({
      owner: 'unavailable-profile',
      canReview: reviewing(),
      accessLevel: reviewing() ? 'owner' : access(),
      supportedLevels: levels,
      mine: request(),
      requests: pending() ? [request()!] : [],
      pendingCount: pending() ? 1 : 0,
    }),
    grants: () =>
      access() == null || access() === 'view'
        ? []
        : [{ userId: 'unavailable-profile', accessLevel: access()! }],
    loading: () => false,
    busy,
    error,
    async refresh() {
      setError(undefined);
    },
    async submit(level, revision) {
      setBusy(true);
      setError(undefined);
      await new Promise((resolve) => setTimeout(resolve, 200));
      setBusy(false);
      if (fail()) {
        setFail(false);
        setError('Could not update access. Try again.');
        throw new Error('offline');
      }
      setRequest({
        id: 'request',
        requesterId: 'unavailable-profile',
        requestedLevel: level,
        revision: (revision ?? 0) + 1,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },
    async cancel() {
      setRequest((current) =>
        current
          ? { ...current, status: 'cancelled', revision: current.revision + 1 }
          : undefined
      );
    },
    async resolve(current, level) {
      setRequest({
        ...current,
        revision: current.revision + 1,
        status: level ? 'granted' : 'denied',
        grantedLevel: level,
        retryAfter: level
          ? undefined
          : new Date(Date.now() + 86_400_000).toISOString(),
      });
      if (level) setAccess(level);
    },
    async setGrant(_user, level) {
      setAccess(level ?? 'view');
    },
    nextPage() {},
    firstPage() {},
  };
  return (
    <main class="min-h-screen bg-page p-4 text-ink">
      <Button onClick={() => setReviewing(!reviewing())}>
        {reviewing() ? 'Act as requester' : 'Act as owner'}
      </Button>
      <Button onClick={() => setFail(true)}>Fail next request</Button>
      <Dialog open={open()} onOpenChange={setOpen}>
        <Dialog.Trigger as={Button}>Share</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 bg-page/70" />
          <Dialog.Content class="fixed left-1/2 top-8 -translate-x-1/2 w-[min(95vw,600px)] rounded-xl border border-edge bg-dialog p-4">
            <Dialog.Title>Share: Browser document</Dialog.Title>
            <PermissionRequestsView source={source} />
            <h3 class="my-3 font-medium">
              People with access to this document
            </h3>
            <div class="grid gap-3 text-sm">
              <div class="flex justify-between">
                <span>Document owner</span>
                <span>Owner</span>
              </div>
              <RequestAccessView source={source} allowedLevels={levels} />
              <DirectAccessView source={source} />
            </div>
            <Show when={error()}>
              <div role="alert">{error()}</div>
            </Show>
            <Dialog.CloseButton as={Button} aria-label="Close">
              Close
            </Dialog.CloseButton>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </main>
  );
}
document.documentElement.dataset.touchDevice = isTouchDevice()
  ? 'true'
  : 'false';
render(() => <Fixture />, document.getElementById('root')!);
