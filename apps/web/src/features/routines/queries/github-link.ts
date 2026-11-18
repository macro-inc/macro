import { authorizeGithub } from '@core/auth/authorize-github';
import { toast } from '@core/component/Toast/Toast';
import {
  useGithubLinkStatusQuery,
  useInitGithubLinkMutation,
} from '@queries/auth';
import type { Accessor } from 'solid-js';

export type GithubConnection = {
  /** Undefined until the link status is known. */
  linked: boolean | undefined;
  connecting: boolean;
  connect: () => Promise<void>;
};

/**
 * Whether the user has linked GitHub, which GitHub triggers need, and how to
 * link it. Status-gated, so a pending status never suspends the trigger menu.
 * On the web, connecting leaves for GitHub and returns to this page; the
 * routine draft survives the round trip.
 */
export function createGithubConnection(): Accessor<GithubConnection> {
  const status = useGithubLinkStatusQuery();
  const init = useInitGithubLinkMutation();
  const connect = async () => {
    try {
      const linked = await authorizeGithub(
        (callbackUrl) => init.mutateAsync(callbackUrl),
        'Failed to connect GitHub'
      );
      if (linked) toast.success('GitHub connected');
    } catch (error) {
      console.error('connect github failed', error);
      toast.failure('Failed to connect GitHub');
    }
  };
  return () => ({
    // A link that needs reauthentication still counts: the row routines read exists.
    linked: status.isSuccess ? status.data.status !== 'unlinked' : undefined,
    connecting: init.isPending,
    connect,
  });
}
