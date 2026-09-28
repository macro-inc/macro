import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useActiveCallsQuery } from '@queries/call/call';
import { useActiveQuickCallsSource } from '../meetings/queries/active-quick-calls';
import { useQuickCallsFlag } from '../meetings/use-quick-calls-flag';

/** Both navigation layouts observe the existing shared call caches. */
export function useHasActiveChannelsCall() {
  if (!ENABLE_CALLS) return () => false;
  const userId = useUserId();
  const channels = useActiveCallsQuery();
  const flag = useQuickCallsFlag();
  const quickCalls = useActiveQuickCallsSource(() =>
    !flag().loading && flag().enabled ? userId() : undefined
  );

  return () =>
    Boolean(userId()) &&
    ((!channels.isPending && (channels.data?.length ?? 0) > 0) ||
      quickCalls.calls().length > 0);
}
