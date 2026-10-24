import { fireAndForget } from '@core/util/fireAndForget';
import { Button, ConfirmDialog } from '@ui';
import { createSignal, For, Match, onMount, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { AccountCard, ConnectCard } from '../components/account-card';
import { AddGroupDialog } from '../components/add-group-dialog';
import { GroupList } from '../components/group-list';
import { PairingDialog, type PasskeyMode } from '../components/pairing-dialog';
import { useWhatsAppLinked } from '../context/whatsapp-linked-context';
import { accountStatus } from '../core/account';
import type { WhatsAppGroup } from '../core/group';
import { createPairingFlow } from '../primitives/pairing-flow';

function Notice(props: { children: string }) {
  return (
    <p role="alert" class="px-1 text-sm text-ink-muted">
      {props.children}
    </p>
  );
}

function LoadFailure(props: { what: string; onRetry: () => void }) {
  return (
    <div class="flex items-center gap-3 px-1 text-sm text-ink-muted">
      <span role="alert">Couldn't load {props.what}.</span>
      <Button type="button" size="sm" variant="outline" onClick={props.onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** The External tab's WhatsApp page: link an account, then add its groups. */
export function WhatsAppPage(props: {
  /** A pairing to show at once, handed off by id from another device. */
  resumePairingId?: string;
}) {
  const whatsapp = useWhatsAppLinked();
  const status = () =>
    whatsapp.account.data === undefined
      ? undefined
      : accountStatus(whatsapp.account.data);
  const linked = () => {
    const current = status();
    return current?.kind === 'connected' ? current : undefined;
  };
  const unlinked = () => {
    const current = status();
    return current?.kind === 'not-connected' ? current : undefined;
  };
  const connected = () => linked() !== undefined;
  const groups = whatsapp.groups(connected);
  const pairing = createPairingFlow(connected, whatsapp);
  // A pairing handed off from a browser opens here in Macro desktop.
  onMount(() => {
    if (props.resumePairingId) pairing.resume(props.resumePairingId);
  });
  const passkeyMode = (): PasskeyMode => {
    const capability = whatsapp.passkey;
    const pairingId = pairing.pairingId();
    return match(capability)
      .with({ kind: 'native' }, () => ({ kind: 'native' as const }))
      .with({ kind: 'handoff' }, ({ desktopUrl }) =>
        pairingId
          ? { kind: 'handoff' as const, desktopUrl: desktopUrl(pairingId) }
          : { kind: 'unsupported' as const }
      )
      .with({ kind: 'unsupported' }, () => ({ kind: 'unsupported' as const }))
      .exhaustive();
  };
  const [confirmingDisconnect, setConfirmingDisconnect] = createSignal(false);
  const [confirmingReplace, setConfirmingReplace] = createSignal(false);
  const [notice, setNotice] = createSignal<string>();
  const [adding, setAdding] = createSignal<WhatsAppGroup>();
  const [addError, setAddError] = createSignal<string>();

  const disconnect = async (generation: number) => {
    setNotice(undefined);
    const result = await whatsapp.disconnect(generation);
    setConfirmingDisconnect(false);
    if (result.isErr()) {
      setNotice("Couldn't disconnect WhatsApp. Try again.");
      return;
    }
    // WhatsApp unlinks the device asynchronously; its Linked devices list is
    // the authority either way.
    setNotice(
      result.value.remoteUnlinkRequested
        ? 'Disconnected. Macro will disappear from WhatsApp → Linked devices on your phone shortly.'
        : 'Disconnected in Macro. To finish, remove Macro under WhatsApp → Linked devices on your phone.'
    );
  };

  const openAddDialog = (group: WhatsAppGroup) => {
    setAddError(undefined);
    setAdding(group);
  };

  const adopt = async (request: { name: string }) => {
    const group = adding();
    if (!group) return;
    setAddError(undefined);
    const result = await whatsapp.adopt({ groupJid: group.jid, ...request });
    if (result.isErr()) {
      setAddError(
        "Couldn't add this group. Check that you're still in it, then try again."
      );
      return;
    }
    setAdding(undefined);
  };

  return (
    <div class="flex max-w-2xl flex-col gap-6">
      <Switch>
        <Match when={whatsapp.account.isPending}>
          <p role="status" class="px-1 text-sm text-ink-muted">
            Loading your WhatsApp connection…
          </p>
        </Match>
        <Match when={!status()}>
          <LoadFailure
            what="your WhatsApp connection"
            onRetry={whatsapp.account.refetch}
          />
        </Match>
        <Match when={linked()}>
          {(current) => (
            <>
              <AccountCard
                account={current().account}
                pending={whatsapp.isDisconnecting() || whatsapp.isConnecting()}
                onDisconnect={() => setConfirmingDisconnect(true)}
                onReplace={() => setConfirmingReplace(true)}
              />
              <Show when={pairing.startFailed()}>
                <Notice>Couldn't start linking WhatsApp. Try again.</Notice>
              </Show>
              <Show when={notice()}>{(text) => <Notice>{text()}</Notice>}</Show>
              <section
                class="flex flex-col gap-1"
                aria-labelledby="whatsapp-groups"
              >
                <h2
                  id="whatsapp-groups"
                  class="px-3 pb-1 text-xs font-medium text-ink-subtle"
                >
                  Your WhatsApp groups
                </h2>
                <Switch>
                  <Match when={groups.data}>
                    {(list) => (
                      <GroupList
                        groups={list().map((group) => ({
                          ...group,
                          unreadCount: whatsapp.sharedGroups.data?.find(
                            (item) => item.id === group.group?.id
                          )?.unreadCount,
                        }))}
                        canAdd={whatsapp.features.data?.adoption ?? false}
                        onAdd={openAddDialog}
                        onOpenGroup={whatsapp.openGroup}
                      />
                    )}
                  </Match>
                  <Match when={groups.isPending}>
                    <p role="status" class="px-3 py-2 text-sm text-ink-muted">
                      Loading groups…
                    </p>
                  </Match>
                  <Match when={groups.isError}>
                    <LoadFailure what="your groups" onRetry={groups.refetch} />
                  </Match>
                </Switch>
              </section>
              <ConfirmDialog
                open={confirmingDisconnect()}
                onOpenChange={setConfirmingDisconnect}
                title="Disconnect WhatsApp?"
                body="Macro stops syncing and sending from this account. Groups and their history stay in Macro."
                confirmLabel="Disconnect"
                tone="danger"
                pending={whatsapp.isDisconnecting()}
                onConfirm={() => disconnect(current().account.generation)}
              />
              <ConfirmDialog
                open={confirmingReplace()}
                onOpenChange={setConfirmingReplace}
                title="Use a different WhatsApp account?"
                body="Sending and syncing from this account stop. Group history stays in Macro. After linking the new account, add its groups again."
                confirmLabel="Link another account"
                onConfirm={() => {
                  setConfirmingReplace(false);
                  fireAndForget(pairing.start(true), 'whatsapp-linked.replace');
                }}
              />
            </>
          )}
        </Match>
        <Match when={unlinked()}>
          {(current) => (
            <div class="flex flex-col gap-3">
              <ConnectCard
                reconnect={current().reconnect}
                unavailable={whatsapp.features.data?.pairing === false}
                pending={whatsapp.isConnecting()}
                onConnect={() => pairing.start(false)}
              />
              <Show when={pairing.startFailed()}>
                <Notice>Couldn't start linking WhatsApp. Try again.</Notice>
              </Show>
              <Show when={notice()}>{(text) => <Notice>{text()}</Notice>}</Show>
            </div>
          )}
        </Match>
      </Switch>
      <Show
        when={
          whatsapp.sharedGroups.data?.filter(
            (group) =>
              !connected() ||
              !groups.data?.some((remote) => remote.group?.id === group.id)
          ).length
        }
      >
        <section
          aria-label="Shared WhatsApp groups"
          class="flex flex-col gap-2"
        >
          <h2 class="px-3 text-xs font-medium text-ink-subtle">
            Groups in Macro
          </h2>
          <For
            each={whatsapp.sharedGroups.data?.filter(
              (group) =>
                !connected() ||
                !groups.data?.some((remote) => remote.group?.id === group.id)
            )}
          >
            {(group) => (
              <Button
                variant="ghost"
                class="justify-between"
                onClick={() => whatsapp.openGroup(group.id)}
              >
                <span class="truncate">{group.name}</span>
                <Show when={group.unreadCount}>
                  <span
                    aria-label={`${group.unreadCount} unread messages`}
                    class="rounded-full bg-accent px-2 text-xs text-panel"
                  >
                    {group.unreadCount}
                  </span>
                </Show>
              </Button>
            )}
          </For>
        </section>
      </Show>
      <Show when={whatsapp.sharedGroups.isError}>
        <LoadFailure
          what="groups shared with you"
          onRetry={whatsapp.sharedGroups.refetch}
        />
      </Show>
      <PairingDialog
        open={pairing.open()}
        step={pairing.step()}
        secondsLeft={pairing.secondsLeft()}
        passkey={passkeyMode()}
        ceremony={pairing.passkey()}
        onConfirmPasskey={() =>
          fireAndForget(pairing.confirmPasskey(), 'whatsapp-linked.passkey')
        }
        onHandOff={pairing.handOff}
        onRetry={pairing.retry}
        onCancel={pairing.cancel}
      />
      <AddGroupDialog
        group={adding()}
        pending={whatsapp.isAdopting()}
        error={addError()}
        onSubmit={adopt}
        onClose={() => setAdding(undefined)}
      />
    </div>
  );
}
