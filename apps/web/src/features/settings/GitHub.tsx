import { SERVER_HOSTS } from '@core/constant/servers';
import { fireAndForget } from '@core/util/fireAndForget';
import { useGithubLinkStatusQuery } from '@queries/auth';
import { makeEventListener } from '@solid-primitives/event-listener';

/**
 * The viewer's GitHub account link, for what only the link knows: the
 * username, and whether the GitHub App can be configured. Whether GitHub is
 * connected is the connectors list's answer, never the link's.
 */
export function useGithubAccountLink() {
  const githubLink = useGithubLinkStatusQuery();

  // GitHub consent runs in another window or the system browser; returning to
  // the app focuses the window without changing page visibility.
  makeEventListener(window, 'focus', () =>
    fireAndForget(githubLink.refetch(), 'github-settings')
  );

  const linked = () =>
    githubLink.isSuccess && githubLink.data.status === 'linked';
  const username = () =>
    githubLink.isSuccess ? githubLink.data.username : undefined;

  return { linked, username };
}

/** Where the viewer installs or configures the GitHub App for their repositories. */
export const GITHUB_APP_INSTALL_URL = `${SERVER_HOSTS['document-storage-service']}/github/install-sync`;
