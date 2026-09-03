import { toast } from '@core/component/Toast/Toast';
import { openExternalUrl } from '@core/util/url';
import {
  useDeleteMcpServerMutation,
  useStartMcpAuthMutation,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import { writeMcpAuthAttempted } from '../mcp-auth-attempt';

export function useNativeMcpActions() {
  const authorize = useStartMcpAuthMutation();
  const update = useUpdateMcpServerMutation();
  const remove = useDeleteMcpServerMutation();

  return {
    authorize,
    update,
    remove,
    startAuth: (url: string, name: string) => {
      authorize.mutate(
        { server_url: url, server_name: name },
        {
          onSuccess: (result) => {
            openExternalUrl(result.authorization_url);
            writeMcpAuthAttempted(url, true);
          },
          onError: () => {
            writeMcpAuthAttempted(url, true);
            toast.failure('Failed to start authorization');
          },
        }
      );
    },
  };
}
