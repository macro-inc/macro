import { CredentialField } from '@channel/Bots/CredentialField';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { toast } from '@core/component/Toast/Toast';
import { useAgentSetupMutation } from '@queries/auth/agent-setup';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { Button, Dialog, Panel } from '@ui';
import { createEffect, Match, Show, Switch } from 'solid-js';

const SDK_DOCS_URL = 'https://sdk.macro.com';

const QUICK_START = `npm install @macro-inc/sdk
export MACRO_API_KEY=<your token>`;

const PROFILE_SNIPPET = `const macro = new Macro({});
const image = await macro.me.uploadProfilePicture(bytes, {
  fileName: 'avatar.png',
  contentType: 'image/png',
});
await macro.me.update({ name: 'Your Name', profilePicture: image });`;

const NEW_TOKEN_SNIPPET = `const { secret } = await macro.apiKeys.create('my token');`;

function Snippet(props: { code: string }) {
  return (
    <pre class="overflow-x-auto rounded-lg border border-edge-muted bg-ink/[0.025] px-3 py-2 font-mono text-xs text-ink">
      {props.code}
    </pre>
  );
}

/**
 * An agent account's first screen: its SDK token and how to use it. Stays open
 * until the agent confirms it saved the token. The token is plain page text so
 * an agent driving a browser can read it. Reloading replaces the token, since a
 * key can only be shown once.
 */
export function AgentSetupModal() {
  const userInfoQuery = useUserInfoQuery();

  const open = () =>
    userInfoQuery.data?.authenticated === true &&
    userInfoQuery.data.isAgent === true &&
    userInfoQuery.data.tutorialComplete === false;

  return (
    <Show when={open()}>
      <AgentSetupDialog />
    </Show>
  );
}

function AgentSetupDialog() {
  const setup = useAgentSetupMutation();
  const confirm = useCompleteTutorialMutation({
    onError: () => toast.failure('Failed to save. Try again.'),
  });

  createEffect(() => {
    if (setup.isIdle) setup.mutate();
  });

  return (
    <Dialog open position="center" class="w-140 max-w-full">
      <Panel depth={2} active class="rounded-xl text-ink">
        <Panel.Header class="px-5">
          <Dialog.Title class="text-sm font-semibold">
            Your agent account is ready
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto p-5 text-sm">
          <Switch>
            <Match when={setup.isError}>
              <p class="text-ink-muted">Couldn’t create your SDK token.</p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setup.mutate()}
              >
                Try again
              </Button>
            </Match>
            <Match when={setup.data}>
              {(result) => (
                <>
                  <p>
                    Use this token to work in Macro through the SDK. Save it
                    now: it is shown only once, and reloading this page replaces
                    it.
                  </p>
                  <Show when={result().team_join_failed}>
                    <p class="text-ink-muted">
                      We couldn’t add you to the team that invited you. Reload
                      this page to try again, which replaces this token.
                    </p>
                  </Show>
                  <CredentialField label="SDK token" value={result().api_key} />
                  <p class="break-all font-mono text-xs text-ink-muted">
                    {result().api_key}
                  </p>
                  <div class="flex flex-col gap-1.5">
                    <span class="text-xs font-medium">1. Use the token</span>
                    <Snippet code={QUICK_START} />
                    <span class="text-xs text-ink-muted">
                      Read the docs at{' '}
                      <a
                        href={SDK_DOCS_URL}
                        target="_blank"
                        rel="noreferrer"
                        class="underline"
                      >
                        sdk.macro.com
                      </a>
                      .
                    </span>
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <span class="text-xs font-medium">
                      2. Set your name and profile picture
                    </span>
                    <Snippet code={PROFILE_SNIPPET} />
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <span class="text-xs font-medium">
                      3. Need another token later?
                    </span>
                    <Snippet code={NEW_TOKEN_SNIPPET} />
                    <span class="text-xs text-ink-muted">
                      You can also create one in Settings → API Keys.
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={confirm.isPending}
                    onClick={() => confirm.mutate()}
                  >
                    I saved this token
                  </Button>
                </>
              )}
            </Match>
            <Match when={true}>
              <div class="flex min-h-36 items-center justify-center">
                <LoadingSpinner class="size-10 p-2" />
              </div>
            </Match>
          </Switch>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
