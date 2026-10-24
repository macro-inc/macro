import { SearchBar } from '@app/components/view-shell';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button, ConfirmDialog } from '@ui';
import { createSignal, type JSX, Match, onMount, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { AccountStrip, ConnectCard } from '../components/account-card';
import {
  AddableChatList,
  ChatSectionHeading,
  InMacroChatList,
  UnsupportedChatList,
} from '../components/chat-list';
import { PairingDialog, type PasskeyMode } from '../components/pairing-dialog';
import { useWhatsAppLinked } from '../context/whatsapp-linked-context';
import { accountStatus } from '../core/account';
import { adoptFailureMessage } from '../core/adopt';
import { chatSections, type WhatsAppChat } from '../core/chat';
import { createPairingFlow } from '../primitives/pairing-flow';

function Notice(props: { children: string }) {
  return (
    <p role="alert" class="text-sm text-ink-muted">
      {props.children}
    </p>
  );
}

function LoadFailure(props: { what: string; onRetry: () => void }) {
  return (
    <div class="flex items-center gap-3 px-4 py-2 text-sm text-ink-muted">
      <span role="alert">Couldn't load {props.what}.</span>
      <Button type="button" size="sm" variant="outline" onClick={props.onRetry}>
        Try again
      </Button>
    </div>
  );
}

function ChatSection(props: {
  id: string;
  title: string;
  children: JSX.Element;
}) {
  return (
    <section class="flex flex-col" aria-labelledby={props.id}>
      <ChatSectionHeading id={props.id}>{props.title}</ChatSectionHeading>
      {props.children}
    </section>
  );
}

/**
 * The External tab's WhatsApp page: link an account, then add its chats from
 * WhatsApp's chat list, newest activity first.
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
  const chats = whatsapp.chats(connected);
  const [query, setQuery] = createSignal('');
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
  const adopt = async (chat: WhatsAppChat) => {
    if (adding().has(chat.jid)) return;
    setAddErrors(({ [chat.jid]: _previous, ...rest }) => rest);
    setPending(chat.jid, true);
    const result = await whatsapp.adopt(chat.jid);
    setPending(chat.jid, false);
    if (result.isErr())
      setAddErrors((current) => ({
        ...current,
        [chat.jid]: adoptFailureMessage(result.error),
      }));
  };

  return (
    <div class="flex min-w-0 flex-col">
      <Switch>
        <Match when={whatsapp.account.isPending}>
          <p role="status" class="px-4 py-4 text-sm text-ink-muted">
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
              <div class="sticky top-0 z-10 flex flex-col gap-2 bg-panel px-4 pt-4 pb-1 touch:static">
                <div class="flex min-w-0 items-center gap-3 touch:flex-col-reverse touch:items-stretch">
                  <SearchBar
                    label="Search WhatsApp chats"
                    placeholder="Search chats"
                    value={query()}
                    onValueChange={setQuery}
                    class="max-w-md flex-1 touch:max-w-none"
                  />
                  <div class="ml-auto min-w-0 touch:ml-0">
                    <AccountStrip
                      account={current().account}
                      pending={
                        whatsapp.isDisconnecting() || whatsapp.isConnecting()
                      }
                      onDisconnect={() => setConfirmingDisconnect(true)}
                    />
                  </div>
                </div>
                <Show when={pairing.startFailed()}>
                  <Notice>Couldn't start linking WhatsApp. Try again.</Notice>
                </Show>
                <Show when={notice()}>
                  {(text) => <Notice>{text()}</Notice>}
                </Show>
              </div>
              <Switch>
                <Match when={chats.data}>
                  {(list) => {
                    const sections = () => chatSections(list(), query());
                    const searching = () => query().trim() !== '';
                    return (
                      <>
                        {/* External's sidebar (or the phone's drill-in list)
                            already lists added chats; here only search hits. */}
                        <Show when={searching() && sections().inMacro.length}>
                          <ChatSection id="whatsapp-in-macro" title="In Macro">
                            <InMacroChatList
                              chats={sections().inMacro}
                              onOpenGroup={whatsapp.openGroup}
                            />
                          </ChatSection>
                        </Show>
                        <ChatSection
                          id="whatsapp-add-groups"
                          title="Add to Macro"
                        >
                          <AddableChatList
                            chats={sections().addable}
                            canAdd={whatsapp.features.data?.adoption ?? false}
                            adding={adding()}
                            errors={addErrors()}
                            empty={
                              searching()
                                ? 'No chats to add match your search.'
                                : 'Every WhatsApp chat you can add is already in Macro.'
                            }
                            onAdd={(chat) =>
                              fireAndForget(
                                adopt(chat),
                                'whatsapp-linked.adopt'
                              )
                            }
                            onOpenGroup={whatsapp.openGroup}
                          />
                        </ChatSection>
                        <Show when={sections().unsupported.length}>
                          <UnsupportedChatList
                            chats={sections().unsupported}
                            forceOpen={searching()}
                          />
                        </Show>
                      </>
                    );
                  }}
                </Match>
                <Match when={chats.isPending}>
                  <p role="status" class="px-4 py-2 text-sm text-ink-muted">
                    Loading chats…
                  </p>
                </Match>
                <Match when={chats.isError}>
                  <LoadFailure what="your chats" onRetry={chats.refetch} />
                </Match>
              </Switch>
              <ConfirmDialog
                open={confirmingDisconnect()}
                onOpenChange={setConfirmingDisconnect}
                title="Disconnect WhatsApp?"
                body="Macro stops syncing and sending from this account. Chats and their history stay in Macro."
                confirmLabel="Disconnect"
                tone="danger"
                pending={whatsapp.isDisconnecting()}
                onConfirm={() => disconnect(current().account.generation)}
              />
            </>
          )}
        </Match>
        <Match when={unlinked()}>
          {(current) => (
            <div class="flex flex-col gap-3 px-4 py-4">
              <ConnectCard
                reconnect={current().reconnect}
                unavailable={whatsapp.features.data?.pairing === false}
                pending={whatsapp.isConnecting()}
                onConnect={() => pairing.start()}
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
