import { toast } from '@core/component/Toast/Toast';
import { useIsAuthenticated } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { getNativeMobilePlatform } from '@core/util/platform';
import IconGoogle from '@icon/macro-google.svg';
import GithubIcon from '@icon/mcp-github.svg';
import {
  invalidateGithubLinkStatus,
  useGithubLinkStatusQuery,
  useInitGithubLinkMutation,
} from '@queries/auth';
import { useEmailLinksQuery } from '@queries/email/link';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';

/**
 * DEBUG: flip to `true` to simulate a connected GitHub account without running. Leave `false`
 * in committed code.
 */
const DEBUG_FAKE_GITHUB = false;
const DEBUG_FAKE_GITHUB_USERNAME = 'octocat';

/**
 * Onboarding step 1 — connect additional accounts once the user is signed in:
 * extra Gmail inboxes (up to the free limit, then the paywall) and their
 * GitHub account. The bottom of the page lists everything currently connected.
 */
export function OnboardingConnectAccounts() {
  const isAuthenticated = useIsAuthenticated();

  const linksQuery = useEmailLinksQuery();
  const addInbox = useAddInboxFlow();

  const githubLink = useGithubLinkStatusQuery();
  const initGithubLink = useInitGithubLinkMutation();

  // Locally-simulated GitHub connection, gated behind DEBUG_FAKE_GITHUB. Starts
  // connected when the flag is on; also set by connectGithub's debug shortcut.
  const [debugGithubConnected, setDebugGithubConnected] =
    createSignal(DEBUG_FAKE_GITHUB);

  const githubLinked = () =>
    debugGithubConnected() || githubLink.data?.status === 'linked';
  const githubLabel = () => {
    const username = debugGithubConnected()
      ? DEBUG_FAKE_GITHUB_USERNAME
      : githubLink.data?.username;
    return username ? `@${username}` : 'GitHub';
  };

  const hasConnectedAccounts = () =>
    (linksQuery.data?.links.length ?? 0) > 0 || githubLinked();

  const connectGithub = async () => {
    if (githubLinked()) return;
    if (DEBUG_FAKE_GITHUB) {
      setDebugGithubConnected(true);
      toast.success('GitHub connected (debug)');
      return;
    }
    const isIos = getNativeMobilePlatform() === 'ios';
    try {
      const authorizationUrl = await initGithubLink.mutateAsync(
        isIos ? 'macro://github-link-callback' : window.location.href
      );

      if (!isIos) {
        // Web / non-iOS native: the OAuth callback redirects back to original_url.
        window.location.href = authorizationUrl;
        return;
      }

      // iOS: run the OAuth inline in an ASWebAuthenticationSession via the Tauri
      // auth plugin; the GitHub link is completed server-side when the callback
      // fires, so we just refresh the status afterwards.
      const auth = await invoke<{
        success: boolean;
        token?: string;
        error?: string;
      }>('plugin:auth|authenticate', {
        payload: {
          authUrl: authorizationUrl,
          callbackScheme: 'macro',
          ephemeralSession: true,
        },
      });

      if (!auth.success) {
        if (auth.error !== 'User canceled login') {
          toast.failure('Failed to connect GitHub');
        }
        return;
      }

      await invalidateGithubLinkStatus();
      toast.success('GitHub connected');
    } catch (error) {
      console.error('connect github failed', error);
      toast.failure('Failed to connect GitHub');
    }
  };

  return (
    <div class="h-full flex flex-col gap-6 justify-between">
      <h1 class="text-2xl font-semibold tracking-tight text-ink">
        Connect More Accounts
      </h1>
      <div>
        <div class="flex flex-col gap-2">
          <Button
            variant="strong"
            size="xl"
            class="border border-edge-muted"
            disabled={!isAuthenticated()}
            onClick={() => void addInbox()}
          >
            <IconGoogle class="size-5" />
            Connect Another Gmail
          </Button>
          <p class="text-sm/relaxed text-ink-muted">
            Connect multiple accounts to see all your emails in one inbox.
          </p>
        </div>

        <div class="h-8" />

        <div class="flex flex-col gap-2">
          <Button
            variant="strong"
            size="xl"
            class="border border-edge-muted"
            disabled={
              !isAuthenticated() || githubLinked() || initGithubLink.isPending
            }
            onClick={() => void connectGithub()}
          >
            <GithubIcon class="size-5" />
            {githubLinked() ? 'GitHub Connected' : 'Connect GitHub'}
          </Button>
          <p class="text-sm/relaxed text-ink-muted">
            Connect GitHub account to see pull requests in your inbox.
          </p>
        </div>
      </div>

      <Show when={hasConnectedAccounts()}>
        <div>
          <h1 class="pb-2">Connected Accounts</h1>
          <div class="flex flex-col overflow-hidden rounded-lg border border-edge-muted">
            <For each={linksQuery.data?.links ?? []}>
              {(link) => (
                <AccountRow
                  icon={<IconGoogle />}
                  label={link.email_address}
                  badge={link.is_primary ? 'Primary' : undefined}
                />
              )}
            </For>
            <Show when={githubLinked()}>
              <AccountRow icon={<GithubIcon />} label={githubLabel()} />
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

function AccountRow(props: {
  icon: JSX.Element;
  label: string;
  badge?: string;
}) {
  return (
    <div class="bg-surface flex min-h-12 items-center justify-between gap-3 border-b border-edge-muted px-4 py-2 last:border-b-0">
      <span class="flex min-w-0 items-center gap-4">
        <span class="size-4 shrink-0">{props.icon}</span>
        <span class="ph-no-capture truncate text-sm">{props.label}</span>
      </span>
      <Show when={props.badge}>
        <span class="rounded bg-edge-muted px-1.5 py-0.5 text-xxs font-medium uppercase">
          {props.badge}
        </span>
      </Show>
    </div>
  );
}
