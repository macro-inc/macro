import { lazyNamed } from '@core/util/lazyNamed';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { Show, Suspense } from 'solid-js';

// Only an agent that has not confirmed its token ever sees it.
const AgentSetupDialog = lazyNamed(
  () => import('./agent-setup-dialog'),
  'AgentSetupDialog'
);

/** Opens an agent's setup dialog until it confirms it saved its token. */
export function AgentSetupModal() {
  const userInfoQuery = useUserInfoQuery();

  const open = () => {
    // A pending read would suspend the chrome, so wait for the user. A failed
    // background refetch keeps its data: unmounting the dialog then would mint
    // a new token and revoke the one the agent already saw.
    const settled = userInfoQuery.isSuccess || userInfoQuery.isRefetchError;
    const data = settled ? userInfoQuery.data : undefined;
    return (
      data?.authenticated === true &&
      data.isAgent === true &&
      data.tutorialComplete === false
    );
  };

  return (
    <Show when={open()}>
      <Suspense>
        <AgentSetupDialog />
      </Suspense>
    </Show>
  );
}
