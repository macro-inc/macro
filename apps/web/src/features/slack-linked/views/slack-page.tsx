import { SearchBar } from '@app/components/view-shell';
import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Checkbox, ConfirmDialog } from '@ui';
import { createSignal, For, Match, onMount, Show, Switch } from 'solid-js';
import { ConversationSection } from '../../whatsapp-linked/components/conversation-sections';
import {
  ConnectCard,
  SessionEndedCard,
  WorkspaceStrip,
} from '../components/account-card';
import {
  ConversationList,
  UnsupportedConversationList,
} from '../components/conversation-list';
import { SignInDialog } from '../components/sign-in-dialog';
import { useSlackLinked } from '../context/slack-linked-context';
import { accountsView, type SlackAccount } from '../core/account';
import {
  addFailureMessage,
  type SlackConversation,
  type WorkspaceCatalogue,
  workspaceCatalogues,
  workspaceSectionId,
} from '../core/conversation';
import { createSignInFlow } from '../primitives/sign-in-flow';

function LoadFailure(props: { what: string; onRetry: () => void }) {
  return (
    <div class="flex items-center gap-3 px-4 py-2 text-sm text-ink-muted">
      <span role="alert">Couldn't load {props.what}.</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={props.onRetry}
      >
        Try again
      </Button>
    </div>
  );
}

/** How the page was opened from another device or a deep link. */
export type SlackHandoff =
  /** Continue this sign-in attempt (a captcha or SSO step). */
  | { kind: 'login'; loginId: string }
  /** Open Slack's own sign-in in a Macro desktop window. */
  | { kind: 'browser' };

/**
 * The External tab's Slack page: sign in to workspaces, then add their Slack
 * Connect conversations, grouped by workspace.
 */
export function SlackPage(props: { handoff?: SlackHandoff }) {
  const slack = useSlackLinked();
  const view = () =>
    slack.accounts.data ? accountsView(slack.accounts.data) : undefined;
  const hasLive = () => (view()?.live.length ?? 0) > 0;
  const catalogue = slack.catalogue(hasLive);
  const [query, setQuery] = createSignal('');
  const flow = createSignInFlow(slack);
  onMount(() => {
    const handoff = props.handoff;
    if (!handoff) return;
    if (handoff.kind === 'login') flow.start(handoff.loginId);
    else if (slack.desktop.kind === 'native') flow.startBrowser();
    else flow.start();
  });

  const [disconnecting, setDisconnecting] = createSignal<SlackAccount>();
  const [signOut, setSignOut] = createSignal(true);
  const disconnect = async (account: SlackAccount) => {
    const result = await slack.disconnect(account, { signOut: signOut() });
    setDisconnecting(undefined);
    if (result.isErr()) {
      toast.failure(`Couldn't disconnect ${account.teamName}. Try again.`);
      return;
    }
    toast.success(`Disconnected ${account.teamName}.`);
  };

  const [adding, setAdding] = createSignal<ReadonlySet<string>>(new Set());
  const [addErrors, setAddErrors] = createSignal<Record<string, string>>({});
  const setPending = (remoteId: string, pending: boolean) =>
    setAdding((current) => {
      const next = new Set(current);
      if (pending) next.add(remoteId);
      else next.delete(remoteId);
      return next;
    });
  const add = async (conversation: SlackConversation) => {
    const id = conversation.remoteId;
    if (adding().has(id)) return;
    setAddErrors(({ [id]: _previous, ...rest }) => rest);
    setPending(id, true);
    const result = await slack.add(conversation);
    setPending(id, false);
    if (result.isErr()) {
      setAddErrors((current) => ({
        ...current,
        [id]: addFailureMessage(result.error),
      }));
      return;
    }
    const { chatId } = result.value;
    toast.success(`Added ${conversation.name}`, {
      subtext: 'Macro is bringing in its last 90 days of messages',
      dismissStyle: 'icon',
      actions: [{ label: 'Open', onClick: () => slack.openChat(chatId) }],
    });
  };

  const workspace = (entry: WorkspaceCatalogue) => {
    const searching = () => query().trim() !== '';
    const isOpen = (id: string) => searching() || slack.sections.isOpen(id);
    const list = (label: string, conversations: SlackConversation[]) => (
      <ConversationList
        label={label}
        conversations={conversations}
        adding={adding()}
        errors={addErrors()}
        onAdd={(conversation) =>
          fireAndForget(add(conversation), 'slack-linked.add')
        }
        onOpenChat={slack.openChat}
      />
    );
    const section = (id: string, title: string, items: SlackConversation[]) => (
      <Show when={items.length}>
        <ConversationSection
          title={title}
          open={isOpen(id)}
          onOpenChange={(open) => slack.sections.setOpen(id, open)}
        >
          {list(title, items)}
        </ConversationSection>
      </Show>
    );
    const empty = () =>
      !entry.channels.length &&
      !entry.direct.length &&
      !entry.unsupported.length;
    const [unsupportedOpen, setUnsupportedOpen] = createSignal(false);
    return (
      <section
        class="flex flex-col gap-1 pt-4"
        aria-label={entry.account.teamName}
      >
        <div class="px-4 pb-1">
          <WorkspaceStrip
            account={entry.account}
            pending={slack.isDisconnecting()}
            onDisconnect={() => {
              setSignOut(true);
              setDisconnecting(entry.account);
            }}
            onSignInAgain={() => flow.start()}
          />
        </div>
        <div class="flex flex-col gap-(--sidebar-section-gap) px-2">
          {section(
            workspaceSectionId.channels(entry.account.id),
            'Slack Connect channels',
            entry.channels
          )}
          {section(
            workspaceSectionId.direct(entry.account.id),
            'Direct messages',
            entry.direct
          )}
          <Show when={entry.unsupported.length}>
            <ConversationSection
              title={`Can't be added (${entry.unsupported.length})`}
              open={unsupportedOpen() || searching()}
              onOpenChange={setUnsupportedOpen}
            >
              <UnsupportedConversationList conversations={entry.unsupported} />
            </ConversationSection>
          </Show>
          <Show when={empty()}>
            <p class="px-2 py-1 text-sm text-ink-extra-muted">
              {searching()
                ? 'Nothing here matches your search.'
                : entry.account.state === 'connecting' ||
                    catalogue.data?.refreshing
                  ? 'Looking for Slack Connect conversations…'
                  : 'No Slack Connect conversations. Channels shared with other organizations, and DMs with people outside this workspace, show up here.'}
            </p>
          </Show>
        </div>
      </section>
    );
  };

  return (
    <div class="flex min-w-0 flex-col">
      <Switch>
        <Match when={slack.accounts.isPending}>
          <ViewSkeleton.Rows
            label="Loading your Slack workspaces"
            count={2}
            class="px-2 py-3"
          />
        </Match>
        <Match when={!view()}>
          <LoadFailure
            what="your Slack workspaces"
            onRetry={slack.accounts.refetch}
          />
        </Match>
        <Match when={view()}>
          {(current) => (
            <>
              <Show when={hasLive()}>
                <div class="sticky top-0 z-10 flex flex-col gap-2 bg-panel px-4 pt-4 pb-1 touch:static">
                  <div class="flex min-w-64 max-w-md flex-1 items-center gap-2 touch:min-w-0 touch:max-w-none">
                    <SearchBar
                      label="Search Slack conversations"
                      placeholder="Search conversations and organizations"
                      value={query()}
                      onValueChange={setQuery}
                      class="min-w-0 flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label="Add workspace"
                      onClick={() => flow.start()}
                    >
                      <PlusIcon class="size-3.5" />
                      <span class="mobile:hidden">Add workspace</span>
                    </Button>
                  </div>
                </div>
              </Show>
              <Show when={current().ended.length || !hasLive()}>
                <div class="flex flex-col gap-3 px-4 pt-4">
                  <For each={current().ended}>
                    {(account) => (
                      <SessionEndedCard
                        account={account}
                        onSignIn={() => flow.start()}
                      />
                    )}
                  </For>
                  <Show when={!hasLive() && !current().ended.length}>
                    <ConnectCard
                      desktop={slack.desktop.kind === 'native'}
                      pending={flow.open()}
                      onSignIn={() => flow.start()}
                    />
                  </Show>
                </div>
              </Show>
              <Show when={hasLive()}>
                <Switch>
                  <Match when={catalogue.data}>
                    {(data) => (
                      <For
                        each={workspaceCatalogues(
                          current().live,
                          data().conversations,
                          query()
                        )}
                      >
                        {workspace}
                      </For>
                    )}
                  </Match>
                  <Match when={catalogue.isPending}>
                    <ViewSkeleton.Rows
                      label="Loading Slack Connect conversations"
                      class="px-2 pt-3"
                    />
                  </Match>
                  <Match when={catalogue.isError}>
                    <LoadFailure
                      what="your Slack Connect conversations"
                      onRetry={catalogue.refetch}
                    />
                  </Match>
                </Switch>
              </Show>
            </>
          )}
        </Match>
      </Switch>
      <ConfirmDialog
        open={!!disconnecting()}
        onOpenChange={(open) => {
          if (!open) setDisconnecting(undefined);
        }}
        title={`Disconnect ${disconnecting()?.teamName ?? 'Slack'}?`}
        confirmLabel="Disconnect"
        tone="danger"
        pending={slack.isDisconnecting()}
        onConfirm={() => {
          const account = disconnecting();
          if (account)
            fireAndForget(disconnect(account), 'slack-linked.disconnect');
        }}
      >
        <div class="flex flex-col gap-3">
          <p>
            Macro stops syncing and sending from this workspace. Its chats and
            their history stay in Macro.
          </p>
          <Checkbox
            class="flex items-start gap-2"
            checked={signOut()}
            onChange={setSignOut}
          >
            <Checkbox.Input />
            <Checkbox.Control class="mt-0.5" />
            <span class="flex flex-col gap-0.5">
              <Checkbox.Label class="text-sm text-ink">
                Also sign this session out of Slack
              </Checkbox.Label>
              <span class="text-xs text-ink-extra-muted">
                Leave this off if you pasted the session from a browser you
                still use: signing out ends it there too.
              </span>
            </span>
          </Checkbox>
        </div>
      </ConfirmDialog>
      <SignInDialog flow={flow} desktop={slack.desktop} />
    </div>
  );
}
