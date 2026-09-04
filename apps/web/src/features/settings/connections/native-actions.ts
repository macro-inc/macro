import { toast } from '@core/component/Toast/Toast';
import {
  useDeleteMcpServerMutation,
  useStartMcpAuthMutation,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import { writeMcpAuthAttempted } from '../mcp-auth-attempt';
import { assignOauthUrl, reserveOauthPopup } from './mcp-oauth';

export function useNativeMcpActions() {
  const authorize = useStartMcpAuthMutation();
  const update = useUpdateMcpServerMutation();
  const remove = useDeleteMcpServerMutation();

  return {
    authorize,
    update,
    remove,
    startAuth: (
      url: string,
      name: string,
      extras?: { onStarted?: () => void; onFailed?: () => void }
    ) => {
      const popup = reserveOauthPopup();
      authorize.mutate(
        { server_url: url, server_name: name },
        {
          onSuccess: (result) => {
            assignOauthUrl(popup, result.authorization_url);
            writeMcpAuthAttempted(url, true);
            extras?.onStarted?.();
          },
          onError: () => {
            popup?.close();
            writeMcpAuthAttempted(url, true);
            extras?.onFailed?.();
            toast.failure('Failed to start authorization');
          },
        }
      );
    },
  };
}
