import { SearchBar } from '@app/components/view-shell';
import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button, Checkbox, ConfirmDialog } from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { ConversationSection } from '../../../whatsapp-linked/components/conversation-sections';
import {
  ConnectCard,
  SessionEndedCard,
  WorkspaceStrip,
} from '../../components/account-card';
import {
  ConversationList,
  UnsupportedConversationList,
} from '../../components/conversation-list';
import { SignInDialog } from '../../components/sign-in-dialog';
import {
  type SlackConversation,
  type WorkspaceCatalogue,
  workspaceCatalogues,
  workspaceSectionId,
} from '../../core/conversation';
import type { SlackPageState } from '../../primitives/slack-page';

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

/** What each view shows of a workspace and its conversations. */
export type WorkspaceDisplay = {
  /** The workspace's domain, and each conversation's kind and last activity. */
  details: boolean;
  /** "Add to Macro" spelled out next to its icon. */
  addLabel: boolean;
};

/** One signed-in workspace: its strip, then its conversations by section. */
function WorkspaceSection(props: {
  page: SlackPageState;
  entry: WorkspaceCatalogue;
  display: WorkspaceDisplay;
}) {
  const page = props.page;
  const slack = page.slack;
  const searching = () => page.query().trim() !== '';
  const isOpen = (id: string) => searching() || slack.sections.isOpen(id);
  const list = (label: string, conversations: SlackConversation[]) => (
    <ConversationList
      label={label}
      conversations={conversations}
      adding={page.adding()}
      errors={page.addErrors()}
      onAdd={(conversation) =>
        fireAndForget(page.add(conversation), 'slack-linked.add')
      }
      onOpenChat={slack.openChat}
      details={props.display.details}
      addLabel={props.display.addLabel}
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
    !props.entry.channels.length &&
    !props.entry.direct.length &&
    !props.entry.unsupported.length;
  const [unsupportedOpen, setUnsupportedOpen] = createSignal(false);
  return (
    <section
      class="flex flex-col gap-1 pt-4"
      aria-label={props.entry.account.teamName}
    >
      <div class="px-4 pb-1">
        <WorkspaceStrip
          account={props.entry.account}
          pending={slack.isDisconnecting()}
          onDisconnect={() => page.askDisconnect(props.entry.account)}
          onSignInAgain={() => page.flow.start()}
          domain={props.display.details}
        />
      </div>
      <div class="flex flex-col gap-(--sidebar-section-gap) px-2">
        {section(
          workspaceSectionId.channels(props.entry.account.id),
          'Slack Connect channels',
          props.entry.channels
        )}
        {section(
          workspaceSectionId.direct(props.entry.account.id),
          'Direct messages',
          props.entry.direct
        )}
        <Show when={props.entry.unsupported.length}>
          <ConversationSection
            title={`Can't be added (${props.entry.unsupported.length})`}
            open={unsupportedOpen() || searching()}
            onOpenChange={setUnsupportedOpen}
          >
            <UnsupportedConversationList
              conversations={props.entry.unsupported}
              details={props.display.details}
            />
          </ConversationSection>
        </Show>
        <Show when={empty()}>
          <p class="px-2 py-1 text-sm text-ink-extra-muted">
            {searching()
              ? 'Nothing here matches your search.'
              : props.entry.account.state === 'connecting' ||
                  page.catalogue.data?.refreshing
                ? 'Looking for Slack Connect conversations…'
                : 'No Slack Connect conversations. Channels shared with other organizations, and DMs with people outside this workspace, show up here.'}
          </p>
        </Show>
      </div>
    </section>
  );
}

/** Disconnecting a workspace, with the choice to sign its session out. */
function DisconnectDialog(props: { page: SlackPageState }) {
  const page = props.page;
  return (
    <ConfirmDialog
      open={!!page.disconnecting()}
      onOpenChange={(open) => {
        if (!open) page.setDisconnecting(undefined);
      }}
      title={`Disconnect ${page.disconnecting()?.teamName ?? 'Slack'}?`}
      confirmLabel="Disconnect"
      tone="danger"
      pending={page.slack.isDisconnecting()}
      onConfirm={() => {
        const account = page.disconnecting();
        if (account)
          fireAndForget(page.disconnect(account), 'slack-linked.disconnect');
      }}
    >
      <div class="flex flex-col gap-3">
        <p>
          Macro stops syncing and sending from this workspace. Its chats and
          their history stay in Macro.
        </p>
        <Checkbox
          class="flex items-start gap-2"
          checked={page.signOut()}
          onChange={page.setSignOut}
        >
          <Checkbox.Input />
          <Checkbox.Control class="mt-0.5" />
          <span class="flex flex-col gap-0.5">
            <Checkbox.Label class="text-sm text-ink">
              Also sign this session out of Slack
            </Checkbox.Label>
            <span class="text-xs text-ink-extra-muted">
              Leave this off if you pasted the session from a browser you still
              use: signing out ends it there too.
            </span>
          </span>
        </Checkbox>
      </div>
    </ConfirmDialog>
  );
}

/**
 * The page under each view's search toolbar: account cards, the catalogue
 * grouped by workspace, and the disconnect and sign-in dialogs.
 */
export function SlackPageBody(props: {
  page: SlackPageState;
  /** Search and Add workspace, shown once a workspace is signed in. */
  toolbar: JSX.Element;
  display: WorkspaceDisplay;
}) {
  const page = props.page;
  const slack = page.slack;
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
        <Match when={!page.view()}>
          <LoadFailure
            what="your Slack workspaces"
            onRetry={slack.accounts.refetch}
          />
        </Match>
        <Match when={page.view()}>
          {(current) => (
            <>
              <Show when={page.hasLive()}>{props.toolbar}</Show>
              <Show when={current().ended.length || !page.hasLive()}>
                <div class="flex flex-col gap-3 px-4 pt-4">
                  <For each={current().ended}>
                    {(account) => (
                      <SessionEndedCard
                        account={account}
                        onSignIn={() => page.flow.start()}
                      />
                    )}
                  </For>
                  <Show when={!page.hasLive() && !current().ended.length}>
                    <ConnectCard
                      desktop={slack.desktop.kind === 'native'}
                      pending={page.flow.open()}
                      onSignIn={() => page.flow.start()}
                    />
                  </Show>
                </div>
              </Show>
              <Show when={page.hasLive()}>
                <Switch>
                  <Match when={page.catalogue.data}>
                    {(data) => (
                      <For
                        each={workspaceCatalogues(
                          current().live,
                          data().conversations,
                          page.query()
                        )}
                      >
                        {(entry) => (
                          <WorkspaceSection
                            page={page}
                            entry={entry}
                            display={props.display}
                          />
                        )}
                      </For>
                    )}
                  </Match>
                  <Match when={page.catalogue.isPending}>
                    <ViewSkeleton.Rows
                      label="Loading Slack Connect conversations"
                      class="px-2 pt-3"
                    />
                  </Match>
                  <Match when={page.catalogue.isError}>
                    <LoadFailure
                      what="your Slack Connect conversations"
                      onRetry={page.catalogue.refetch}
                    />
                  </Match>
                </Switch>
              </Show>
            </>
          )}
        </Match>
      </Switch>
      <DisconnectDialog page={page} />
      <SignInDialog flow={page.flow} desktop={slack.desktop} />
    </div>
  );
}

/** Search across every workspace's conversations. */
export function ConversationSearch(props: { page: SlackPageState }) {
  return (
    <SearchBar
      label="Search Slack conversations"
      placeholder="Search conversations and organizations"
      value={props.page.query()}
      onValueChange={props.page.setQuery}
      class="min-w-0 flex-1"
    />
  );
}
