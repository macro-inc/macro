import '@app/index.css';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { CallSharingMenu } from '../CallSharingMenu';
import { CallTeamShareChangeStatus } from '../CallTeamShareChangeStatus';

const REQUESTER = 'macro|requester@example.com';
const OTHER = 'macro|other@example.com';
const role = new URLSearchParams(location.search).get('role');

function Fixture() {
  const [pending, setPending] = createSignal(
    role === 'none'
      ? null
      : { shared: true, requestedBy: REQUESTER, waitingOn: [OTHER] }
  );
  const [toggles, setToggles] = createSignal(0);

  return (
    <div class="flex h-screen items-end justify-center p-8">
      <output data-testid="toggles">{toggles()}</output>
      <CallSharingMenu
        sharedWithTeam={false}
        disabled={false}
        changePending={pending() !== null}
        status={
          <CallTeamShareChangeStatus
            change={{
              pending,
              awaitsMyAnswer: () => pending() !== null && role === 'approver',
              isMine: () => pending() !== null && role === 'requester',
              isAnswering: () => false,
              answer: () => setPending(null),
            }}
          />
        }
        onToggle={() => setToggles(toggles() + 1)}
        onOpenChange={() => undefined}
      />
    </div>
  );
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Fixture />
    </QueryClientProvider>
  ),
  document.getElementById('root') as HTMLElement
);
