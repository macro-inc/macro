import { getMeetingPath, getMeetingShareToken } from '@channel/Call/call-link';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { useNavigate } from '@solidjs/router';
import { Show, Suspense } from 'solid-js';
import { LiveCallsSidebar } from '../meetings/components/live-calls-sidebar';
import { useActiveQuickCallsSource } from '../meetings/queries/active-quick-calls';

function ChannelsLiveCalls() {
  const userId = useUserId();
  const source = useActiveQuickCallsSource(userId);
  const navigate = useNavigate();
  const calls = () =>
    source.calls().map((call) => ({
      id: call.id,
      url: call.url,
      label: `Call with ${
        (call.createdBy && idToDisplayName(call.createdBy)) || 'someone'
      }`,
    }));

  return (
    <LiveCallsSidebar
      calls={calls()}
      onJoin={(call) => {
        const token = getMeetingShareToken(call.url);
        if (token) navigate(getMeetingPath(token));
      }}
    />
  );
}

/** Active quick calls belong to the Chat workspace, outside its conversation tree. */
export function ChannelsLiveCallsSidebar() {
  return (
    <Show when={ENABLE_CALLS}>
      <Suspense>
        <ChannelsLiveCalls />
      </Suspense>
    </Show>
  );
}
