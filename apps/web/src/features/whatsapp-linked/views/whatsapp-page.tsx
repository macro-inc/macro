import { SearchBar } from '@app/components/view-shell';
import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import NotePencilIcon from '@phosphor/note-pencil.svg';
import { Button, ConfirmDialog } from '@ui';
import { createSignal, Match, onMount, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { AccountStrip, ConnectCard } from '../components/account-card';
import { ChatList, UnsupportedChatList } from '../components/chat-list';
import {
  ConversationSection,
  ConversationSectionList,
} from '../components/conversation-sections';
import { NewChatDialog } from '../components/new-chat-dialog';
import { PairingDialog, type PasskeyMode } from '../components/pairing-dialog';
import { useWhatsAppLinked } from '../context/whatsapp-linked-context';
import { accountStatus } from '../core/account';
import { addFailureMessage } from '../core/add';
import {
  chatSections,
  conversationSections,
  type WhatsAppChat,
} from '../core/chat';
import { createPairingFlow } from '../primitives/pairing-flow';

/** The Contacts section's id for its remembered open state. */
const CONTACTS_SECTION = 'contacts';

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
  const [startingChat, setStartingChat] = createSignal(false);
  const [adding, setAdding] = createSignal<ReadonlySet<string>>(new Set());
  const [addErrors, setAddErrors] = createSignal<Record<string, string>>({});

  const disconnect = async (generation: number) => {
    const result = await whatsapp.disconnect(generation);
    setConfirmingDisconnect(false);
    if (result.isErr()) {
      toast.failure("Couldn't disconnect WhatsApp. Try again.");
      return;
    }
    // WhatsApp unlinks the device asynchronously; its Linked devices list is
    // the authority either way.
    toast.success(
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
  const add = async (chat: WhatsAppChat) => {
    if (adding().has(chat.jid)) return;
    setAddErrors(({ [chat.jid]: _previous, ...rest }) => rest);
    setPending(chat.jid, true);
    const result = await whatsapp.add(chat);
    setPending(chat.jid, false);
    if (result.isErr())
      setAddErrors((current) => ({
        ...current,
        [chat.jid]: addFailureMessage(result.error),
      }));
  };

  return (
    <div class="flex min-w-0 flex-col">
      <Switch>
        <Match when={whatsapp.account.isPending}>
          <ViewSkeleton.Rows
            label="Loading your WhatsApp connection"
            count={2}
            class="px-2 py-3"
          />
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
                <div class="flex min-w-0 flex-wrap items-center gap-3 touch:flex-col-reverse touch:flex-nowrap touch:items-stretch">
                  <div class="flex min-w-64 max-w-md flex-1 items-center gap-2 touch:min-w-0 touch:max-w-none">
                    <SearchBar
                      label="Search WhatsApp chats"
                      placeholder="Search chats and contacts"
                      value={query()}
                      onValueChange={setQuery}
                      class="min-w-0 flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label="New chat"
                      onClick={() => setStartingChat(true)}
                    >
                      <NotePencilIcon class="size-3.5" />
                      <span class="mobile:hidden">New chat</span>
                    </Button>
                  </div>
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
              </div>
              <Switch>
                <Match when={chats.data}>
                  {(list) => {
                    const sections = () => chatSections(list(), query());
                    const searching = () => query().trim() !== '';
                    const kinds = () => conversationSections(sections().listed);
                    return (
                      <>
                        {/* External's sidebar (or the phone's drill-in list)
                            already lists added chats; here only search hits. */}
                        <div class="flex flex-col gap-(--sidebar-section-gap) px-2 pt-3">
                          <ConversationSectionList
                            sections={kinds()}
                            // A search shows its matches in every section.
                            isOpen={(id) =>
                              searching() || whatsapp.sections.isOpen(id)
                            }
                            onOpenChange={whatsapp.sections.setOpen}
                            list={(items, label) => (
                              <ChatList
                                label={label}
                                chats={items}
                                inCommunity={items[0]?.community !== undefined}
                                adding={adding()}
                                errors={addErrors()}
                                onAdd={(chat) =>
                                  fireAndForget(
                                    add(chat),
                                    'whatsapp-linked.add'
                                  )
                                }
                                onOpenChat={whatsapp.openChat}
                              />
                            )}
                          />
                        </div>
                        <Show when={sections().contacts.length}>
                          <div class="px-2 pt-(--sidebar-section-gap)">
                            <ConversationSection
                              title="Contacts"
                              open={
                                searching() ||
                                whatsapp.sections.isOpen(CONTACTS_SECTION)
                              }
                              onOpenChange={(open) =>
                                whatsapp.sections.setOpen(
                                  CONTACTS_SECTION,
                                  open
                                )
                              }
                            >
                              <ChatList
                                label="Contacts"
                                chats={sections().contacts}
                                adding={adding()}
                                errors={addErrors()}
                                onAdd={(chat) =>
                                  fireAndForget(
                                    add(chat),
                                    'whatsapp-linked.add'
                                  )
                                }
                                onOpenChat={whatsapp.openChat}
                              />
                            </ConversationSection>
                          </div>
                        </Show>
                        <Show
                          when={
                            !sections().listed.length &&
                            !sections().contacts.length
                          }
                        >
                          <p class="px-4 py-2 text-sm text-ink-extra-muted">
                            {searching()
                              ? 'No chats or contacts match your search. To message someone else, start a new chat with their number.'
                              : 'Every WhatsApp chat you can add is already in Macro.'}
                          </p>
                        </Show>
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
                  <ViewSkeleton.Rows label="Loading chats" class="px-2 pt-3" />
                </Match>
                <Match when={chats.isError}>
                  <LoadFailure what="your chats" onRetry={chats.refetch} />
                </Match>
              </Switch>
              <NewChatDialog
                open={startingChat()}
                onOpenChange={setStartingChat}
                onStart={(phoneNumber) =>
                  whatsapp
                    .startChat(phoneNumber)
                    .map(({ chatId }) => whatsapp.openChat(chatId))
                }
              />
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
                phone={isMobile()}
                pending={whatsapp.isConnecting()}
                onConnect={() => pairing.start()}
              />
              <Show when={pairing.startFailed() && !pairing.open()}>
                <Notice>Couldn't start linking WhatsApp. Try again.</Notice>
              </Show>
            </div>
          )}
        </Match>
      </Switch>
      <PairingDialog
        open={pairing.open()}
        step={pairing.step()}
        refreshing={pairing.refreshing()}
        retryFailed={pairing.startFailed()}
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
