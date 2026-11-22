import { authorizeGithub } from '@core/auth/authorize-github';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  useDeleteGithubLinkMutation,
  useGithubLinkStatusQuery,
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from '@queries/auth';
import { makeEventListener } from '@solid-primitives/event-listener';
import type { ConnectionState } from './integration-ui';

/** The viewer's GitHub account link and the actions that change it. */
export function useGithubConnection() {
  const githubLink = useGithubLinkStatusQuery();
  const initGithubLink = useInitGithubLinkMutation();
  const deleteGithubLink = useDeleteGithubLinkMutation();
  const reauthenticateGithub = useReauthenticateGithubMutation();

  // GitHub consent runs in another window or the system browser; returning to
  // the app focuses the window without changing page visibility.
  makeEventListener(window, 'focus', () =>
    fireAndForget(githubLink.refetch(), 'github-settings')
  );

  const status = () =>
    githubLink.isSuccess ? githubLink.data.status : undefined;
  const username = () =>
    githubLink.isSuccess ? githubLink.data.username : undefined;

  // Drives the account connection dot.
  const connectionState = (): ConnectionState | undefined =>
    status() === 'linked'
      ? 'connected'
      : status() === 'reauthentication_required'
        ? 'attention'
        : undefined;

  const connect = async () => {
    try {
      await authorizeGithub(
        (callbackUrl) => initGithubLink.mutateAsync(callbackUrl),
        'Failed to connect GitHub'
      );
    } catch {
      toast.failure('Failed to start GitHub connect flow');
    }
  };

  const disconnect = async () => {
    try {
      await deleteGithubLink.mutateAsync();
    } catch {
      toast.failure('Failed to disconnect GitHub');
    }
  };

  const reconnect = async () => {
    try {
      await authorizeGithub(
        (callbackUrl) => reauthenticateGithub.mutateAsync(callbackUrl),
        'Failed to reconnect GitHub'
      );
    } catch {
      toast.failure('Failed to start GitHub reconnect flow');
    }
  };

  return {
    loading: () => githubLink.isLoading,
    status,
    username,
    connectionState,
    connect,
    disconnect,
    reconnect,
    connecting: () => initGithubLink.isPending,
    disconnecting: () => deleteGithubLink.isPending,
    reconnecting: () => reauthenticateGithub.isPending,
  };
}

/** Where the viewer installs or configures the GitHub App for their repositories. */
export const GITHUB_APP_INSTALL_URL = `${SERVER_HOSTS['document-storage-service']}/github/install-sync`;
