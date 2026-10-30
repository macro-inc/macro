import { useAgentDmRecipients } from '@app/features/agent-dms/agent-dm-recipients';
import { selectConversationRecipients } from '@app/features/agent-dms/core/personas';
import { t } from '@app/lib/i18n';
import { openNewChannelModalWithName } from '@channel/CreateChannelModal';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { ENABLE_AGENT_DMS } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { recipientEntityMapper, type WithCustomUserInput } from '@core/user';
import { getDestinationFromOptions } from '@core/util/destination';
import { fireAndForget } from '@core/util/fireAndForget';
import HashIcon from '@icon/system/regular/hash.svg';
import { Telemetry } from '@macro-inc/observability';
import {
  useGetOrCreateDirectMessageMutation,
  useGetOrCreatePrivateChannelMutation,
} from '@queries/channel/get-or-create-dm';
import { Button, Dialog, type ManagedDialogProps, openDialog } from '@ui';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';

function NewConversationDialog(
  props: ManagedDialogProps & { onCreateChannel: (name: string) => void }
) {
  const { openWithSplit } = useSplitLayout();
  const userId = useUserId();
  const { channels } = useChannelsContext();
  const { users } = useCombinedRecipients(['user']);
  const agents = ENABLE_AGENT_DMS ? useAgentDmRecipients() : () => [];
  const options = createMemo(() => [
    ...users(),
    ...agents(),
    ...channels()
      .filter((channel) => channel.channel_type !== 'direct_message')
      .map(recipientEntityMapper('channel')),
  ]);
  const [selected, setSelected] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'agent'>[]
  >([]);
  const [query, setQuery] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const direct = useGetOrCreateDirectMessageMutation();
  const group = useGetOrCreatePrivateChannelMutation();
  let active = true;
  onCleanup(() => {
    active = false;
  });
  const recipients = () => {
    const agent = selected().find((option) => option.kind === 'agent');
    return agent
      ? [`bot|${agent.id}`]
      : getDestinationFromOptions(selected()).users;
  };
  const existing = createMemo(() => {
    const ids = new Set([userId(), ...recipients()]);
    if (recipients().length !== 1) return;
    return channels().find(
      (channel) =>
        channel.channel_type === 'direct_message' &&
        channel.participants.length === ids.size &&
        channel.participants.every((participant) =>
          ids.has(participant.user_id)
        )
    );
  });

  const open = (id: string) => {
    props.onOpenChange(false);
    openWithSplit(
      { type: 'channel', id },
      { referredFrom: 'channels', reopen: 'latest' }
    );
  };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (pending() || recipients().length === 0) return;
    const actor = userId();
    const ids = recipients();
    setPending(true);
    setError('');
    try {
      const result = await Telemetry.span(
        'conversation.resolve',
        async (span) => {
          span.setAttr('conversation.recipient_count', ids.length);
          const resolved =
            ids.length === 1
              ? await direct.mutateAsync({ recipient_id: ids[0] })
              : await group.mutateAsync({ recipients: ids });
          span.setAttr('channel.id', resolved.channel_id);
          return resolved;
        }
      );
      if (active && userId() === actor) open(result.channel_id);
    } catch {
      if (active && userId() === actor)
        setError(t('commandMenu.unableToOpenConversation'));
    } finally {
      if (active) setPending(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!pending()) props.onOpenChange(open);
      }}
      class="w-[min(36rem,90vw)]"
    >
      <form
        class="flex min-h-[min(28rem,80dvh)] flex-col gap-5 p-5"
        onSubmit={(event) => fireAndForget(submit(event), 'new-conversation')}
      >
        <div>
          <Dialog.Title class="text-lg font-semibold">
            {t('channelSections.newConversation')}
          </Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-ink-muted">
            {t('channelSections.findConversation')}
          </Dialog.Description>
        </div>
        <RecipientSelector<'user' | 'contact' | 'channel' | 'agent'>
          options={options}
          selectedOptions={selected()}
          setSelectedOptions={(next) => {
            const channel = next.find((option) => option.kind === 'channel');
            if (channel) {
              open(channel.id);
              return;
            }
            setSelected(
              selectConversationRecipients(
                next.filter((option) => option.kind !== 'channel')
              )
            );
            setError('');
          }}
          onInputChange={setQuery}
          placeholder={t('channelSections.findConversation')}
          portalScope="local"
          noResetInputOnBlur
          disabled={pending()}
          inviteExternalEmails
        />
        <Show when={error()}>
          <p role="alert" class="text-sm text-failure">
            {error()}
          </p>
        </Show>
        <div class="mt-auto flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            disabled={pending()}
            onClick={() => {
              props.onCreateChannel(query().trim());
              props.onOpenChange(false);
            }}
          >
            <HashIcon class="size-4" />
            {t('channelSections.createChannel')}
          </Button>
          <div class="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={pending()}
              onClick={() => props.onOpenChange(false)}
            >
              {t('channelSections.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={pending() || recipients().length === 0}
            >
              {existing()
                ? t('channelSections.openConversation')
                : t('channelSections.startConversation')}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export function openNewConversationDialog() {
  let requestedChannelName: string | undefined;
  const handle = openDialog(
    (props: ManagedDialogProps) => (
      <NewConversationDialog
        {...props}
        onCreateChannel={(name) => {
          requestedChannelName = name;
        }}
      />
    ),
    {}
  );
  const openRequestedChannel = async () => {
    await handle.closed;
    if (requestedChannelName !== undefined)
      openNewChannelModalWithName(requestedChannelName);
  };
  fireAndForget(openRequestedChannel(), 'new-conversation');
}
