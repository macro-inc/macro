import { toast } from '@core/component/Toast/Toast';
import {
  appConnectorKey,
  connectConnector,
  readConnectors,
  useUpdateConnectorMutation,
} from '@queries/connectors';
import type { Tool } from '../context/onboarding-context';

/** Connect a tool, or switch back on one the user holds but turned off. */
export function createOnboardingToolConnect() {
  const update = useUpdateConnectorMutation();

  return async (tool: Tool): Promise<void> => {
    try {
      const key = appConnectorKey(tool.slug);
      // Re-check on click so another tab cannot cause a duplicate connection.
      const held = (await readConnectors()).find(
        (connector) => connector.key === key
      );
      if (held?.status === 'connected') return;
      if (held?.status === 'disabled') {
        await update.mutateAsync({ key, enabled: true });
        return;
      }
      await connectConnector({ key });
    } catch {
      toast.failure(`Failed to connect ${tool.name}`);
    }
  };
}
