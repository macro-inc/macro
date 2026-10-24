import { fireAndForget } from '@core/util/fireAndForget';
import { Button, ConfirmDialog } from '@ui';
import { createSignal, Match, onMount, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { AccountCard, ConnectCard } from '../components/account-card';
import {
  AddableGroupList,
  UnsupportedGroupList,
} from '../components/group-list';
import { PairingDialog, type PasskeyMode } from '../components/pairing-dialog';
import { useWhatsAppLinked } from '../context/whatsapp-linked-context';
import { accountStatus } from '../core/account';
import { adoptFailureMessage } from '../core/adopt';
import { groupSections, type WhatsAppGroup } from '../core/group';
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

/**
 * The External tab's WhatsApp page: link an account, then add its groups.
 * Groups already in Macro are listed in External's sidebar.
 */
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
  const [adding, setAdding] = createSignal<ReadonlySet<string>>(new Set());
  const [addErrors, setAddErrors] = createSignal<Record<string, string>>({});

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

  const setPending = (jid: string, pending: boolean) =>
    setAdding((current) => {
      const next = new Set(current);
      if (pending) next.add(jid);
      else next.delete(jid);
      return next;
    });
  const adopt = async (group: WhatsAppGroup) => {
    if (adding().has(group.jid)) return;
    setAddErrors(({ [group.jid]: _previous, ...rest }) => rest);
    setPending(group.jid, true);
    const result = await whatsapp.adopt(group.jid);
    setPending(group.jid, false);
    if (result.isErr())
      setAddErrors((current) => ({
        ...current,
        [group.jid]: adoptFailureMessage(result.error),
      }));
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
              <Switch>
                <Match when={groups.data}>
                  {(list) => (
                    <>
                      <section
                        class="flex flex-col gap-1"
                        aria-labelledby="whatsapp-add-groups"
                      >
                        <h2
                          id="whatsapp-add-groups"
                          class="px-3 pb-1 text-xs font-medium text-ink-subtle"
                        >
                          Add to Macro
                        </h2>
                        <AddableGroupList
                          groups={groupSections(list()).addable}
                          canAdd={whatsapp.features.data?.adoption ?? false}
                          adding={adding()}
                          errors={addErrors()}
                          onAdd={(group) =>
                            fireAndForget(adopt(group), 'whatsapp-linked.adopt')
                          }
                          onOpenGroup={whatsapp.openGroup}
                        />
                      </section>
                      <Show when={groupSections(list()).unsupported.length}>
                        <UnsupportedGroupList
                          groups={groupSections(list()).unsupported}
                        />
                      </Show>
                    </>
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
    </div>
  );
}
