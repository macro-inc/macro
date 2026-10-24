import { fireAndForget } from '@core/util/fireAndForget';
import { Button, ConfirmDialog } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { GroupComposer } from '../components/group-composer';
import { GroupMessageRow } from '../components/group-message';
import { useWhatsAppGroup } from '../context/whatsapp-group-context';
import { canChangeMessage, composerNote } from '../core/group';
import { createConversation } from '../primitives/conversation';

export function WhatsAppGroupView(props: {
  userId?: string;
  leading?: JSX.Element;
  onShare: () => void;
  onConnect: () => void;
  renderAttachment: (id: string) => JSX.Element;
}) {
  const source = useWhatsAppGroup();
  const conversation = createConversation(source, () => props.userId);
  const [deleting, setDeleting] = createSignal<string>();
  const [replyError, setReplyError] = createSignal<string>();
  const [roster, setRoster] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);
  const [stopped, setStopped] = createSignal(false);
  const [stopError, setStopError] = createSignal<string>();
  const [stopPending, setStopPending] = createSignal(false);
  let scroller: HTMLDivElement | undefined;
  let alive = true;
  let newest: string | undefined;
  onCleanup(() => {
    alive = false;
  });
  const nearBottom = () =>
    !scroller ||
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const messages = () => source.timeline.data ?? [];
  const unreadIndex = () => {
    const read = conversation.initialRead();
    if (!read)
      return conversation.initialUnreadCount()
        ? Math.max(0, messages().length - conversation.initialUnreadCount())
        : -1;
    const index = messages().findIndex((message) => message.id === read);
    return index < 0
      ? conversation.initialUnreadCount()
        ? Math.max(0, messages().length - conversation.initialUnreadCount())
        : -1
      : index + 1;
  };
  onMount(() => {
    const visible = () => {
      if (nearBottom())
        fireAndForget(conversation.markRead(), 'whatsapp-group.read');
    };
    document.addEventListener('visibilitychange', visible);
    onCleanup(() => document.removeEventListener('visibilitychange', visible));
  });
  createEffect(() => {
    const latest = source.timeline.data?.at(-1)?.id;
    if (!latest || latest === newest) return;
    const follow = !newest || nearBottom();
    newest = latest;
    queueMicrotask(() => {
      if (!alive || !follow) return;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      fireAndForget(conversation.markRead(), 'whatsapp-group.read');
    });
  });
  const older = async () => {
    const height = scroller?.scrollHeight ?? 0;
    const offset = scroller?.scrollTop ?? 0;
    await source.loadOlder();
    if (alive && scroller)
      scroller.scrollTop = offset + scroller.scrollHeight - height;
  };
  const openReply = async (id: string) => {
    setReplyError(undefined);
    const find = () =>
      scroller?.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    try {
      while (alive && !find() && source.hasOlder()) {
        const count = messages().length;
        await older();
        if (messages().length === count) break;
      }
      if (!alive) return;
      const row = find();
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else setReplyError('This quoted message is no longer available.');
    } catch {
      if (alive) setReplyError("Couldn't load the quoted message. Try again.");
    }
  };
  return (
    <div
      class="flex h-full min-h-0 min-w-0 flex-col bg-panel text-ink touch:pt-(--mobile-content-inset-top)"
      style={{ '--user-icon-width': '32px', '--message-padding-x': '16px' }}
    >
      <header class="flex min-h-14 shrink-0 items-center gap-2 border-b border-edge-muted px-4">
        {props.leading}
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-sm font-semibold">
            {source.group.data?.name ?? 'WhatsApp group'}
          </h1>
          <span class="text-xs text-ink-muted">WhatsApp</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRoster((value) => !value)}
        >
          Members
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!source.group.data}
          onClick={props.onShare}
        >
          Share
        </Button>
      </header>
      <Show when={roster()}>
        <aside class="max-h-56 shrink-0 overflow-y-auto border-b border-edge-muted p-4">
          <h2 class="mb-2 text-sm font-medium">WhatsApp members</h2>
          <p class="mb-2 text-xs text-ink-muted">
            WhatsApp membership controls who can send. Share controls who can
            read in Macro.
          </p>
          <ul class="space-y-1 text-sm">
            <For each={source.group.data?.members}>
              {(member) => (
                <li>
                  {member.name}
                  {member.admin ? ' · Admin' : ''}
                </li>
              )}
            </For>
          </ul>
          <Show when={source.group.data?.accessLevel === 'owner'}>
            <Button
              class="mt-3"
              variant="outline"
              size="sm"
              disabled={stopped()}
              onClick={() => setStopping(true)}
            >
              {stopped() ? 'Syncing stopped' : 'Stop syncing'}
            </Button>
          </Show>
        </aside>
      </Show>
      <div
        ref={scroller}
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 [overflow-anchor:none]"
        role="log"
        aria-label="WhatsApp messages"
        onScroll={() => {
          if (
            scroller &&
            scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
              60
          )
            fireAndForget(conversation.markRead(), 'whatsapp-group.read');
        }}
      >
        <Show when={source.group.isPending || source.timeline.isPending}>
          <p role="status" class="p-6 text-sm text-ink-muted">
            Loading WhatsApp group…
          </p>
        </Show>
        <Show when={source.group.isError || source.timeline.isError}>
          <div class="p-4 text-sm">
            <p role="alert">
              Couldn't refresh this group. You may need access from its owner.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                source.group.refetch();
                source.timeline.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        </Show>
        <Show when={source.hasOlder()}>
          <div class="flex justify-center p-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={source.loadingOlder()}
              onClick={() => fireAndForget(older(), 'whatsapp-group.older')}
            >
              {source.loadingOlder() ? 'Loading…' : 'Load earlier messages'}
            </Button>
          </div>
        </Show>
        <Show when={source.timeline.data && messages().length === 0}>
          <p class="p-6 text-center text-sm text-ink-muted">
            No messages yet. New WhatsApp messages will appear here.
          </p>
        </Show>
        <For each={messages()}>
          {(message, index) => (
            <GroupMessageRow
              message={message}
              index={index()}
              previousSentAt={messages()[index() - 1]?.sentAt}
              firstUnread={index() === unreadIndex()}
              reply={messages().find((item) => item.id === message.replyTo)}
              canSend={source.group.data?.canSend ?? false}
              busy={conversation.busy()}
              canReact={
                !!source.group.data?.canSend &&
                source.group.data.limits.mutations.includes('reaction')
              }
              canEdit={
                !!source.group.data &&
                canChangeMessage(
                  message,
                  props.userId,
                  source.group.data,
                  Date.now(),
                  'edit'
                )
              }
              canDelete={
                !!source.group.data &&
                canChangeMessage(
                  message,
                  props.userId,
                  source.group.data,
                  Date.now(),
                  'delete'
                )
              }
              onReply={() => conversation.reply(message)}
              onEdit={() => conversation.edit(message)}
              onDelete={() => setDeleting(message.id)}
              onReact={(emoji) =>
                fireAndForget(
                  conversation.mutate({
                    kind: 'reaction',
                    messageId: message.id,
                    emoji,
                  }),
                  'whatsapp-group.react'
                )
              }
              onRead={() =>
                fireAndForget(conversation.markRead(), 'whatsapp-group.read')
              }
              onOpenReply={(id) =>
                fireAndForget(openReply(id), 'whatsapp-group.quote')
              }
              renderAttachment={props.renderAttachment}
            />
          )}
        </For>
      </div>
      <Show when={replyError()}>
        <p role="status" class="px-4 py-2 text-xs text-ink-muted">
          {replyError()}
        </p>
      </Show>
      <Show when={source.sends.isError}>
        <div role="alert" class="px-4 py-2 text-xs text-ink-muted">
          Couldn't refresh pending messages. Check WhatsApp before sending
          again.{' '}
          <Button variant="ghost" size="sm" onClick={source.sends.refetch}>
            Try again
          </Button>
        </div>
      </Show>
      <Show when={source.group.data}>
        {(group) => (
          <GroupComposer
            editing={!!conversation.editing()}
            canSend={group().canSend && !stopped()}
            note={
              stopped()
                ? 'This group is no longer syncing'
                : composerNote(group())
            }
            draft={conversation.draft()}
            busy={conversation.busy()}
            fileName={conversation.file()?.name}
            target={
              conversation.editing()
                ? {
                    name: 'Editing message',
                    body: conversation.editing()?.body ?? '',
                  }
                : conversation.quote()
                  ? {
                      name: conversation.quote()?.sender.name ?? '',
                      body: conversation.quote()?.body ?? '',
                    }
                  : undefined
            }
            pending={source.sends.data ?? []}
            error={conversation.error()}
            onDraft={conversation.setDraft}
            onFile={conversation.setFile}
            onCancelTarget={conversation.cancelTarget}
            onSubmit={() =>
              fireAndForget(conversation.submit(), 'whatsapp-group.send')
            }
            onConnect={props.onConnect}
          />
        )}
      </Show>
      <ConfirmDialog
        open={!!deleting()}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Delete this message for everyone?"
        body="This also deletes the message in WhatsApp."
        confirmLabel="Delete"
        tone="danger"
        pending={conversation.busy()}
        onConfirm={async () => {
          const id = deleting();
          if (id) await conversation.mutate({ kind: 'delete', messageId: id });
          if (alive) setDeleting(undefined);
        }}
      />
      <ConfirmDialog
        open={stopping()}
        onOpenChange={setStopping}
        title="Stop syncing this group?"
        body="Its history stays in Macro. New messages will stop syncing."
        confirmLabel="Stop syncing"
        tone="danger"
        pending={stopPending()}
        onConfirm={async () => {
          setStopPending(true);
          try {
            await source.stopSync();
            if (!alive) return;
            setStopped(true);
            setStopping(false);
          } catch {
            if (alive) setStopError("Couldn't stop syncing. Try again.");
          } finally {
            if (alive) setStopPending(false);
          }
        }}
      />
      <Show when={stopError()}>
        <p role="alert" class="p-2 text-xs text-failure-ink">
          {stopError()}
        </p>
      </Show>
    </div>
  );
}
