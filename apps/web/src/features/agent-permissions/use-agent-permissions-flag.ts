import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableAgentPermissions } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether agent permissions are shown: `enable-agent-permissions`, the one
 * flag on them and on the JS tools programs they gate. The API also answers
 * 404 while it is off, and every surface hides then too.
 */
export function useAgentPermissionsFlag(): Accessor<boolean> {
  const permissions = useFeatureFlag(enableAgentPermissions);
  return () => permissions().enabled;
}
