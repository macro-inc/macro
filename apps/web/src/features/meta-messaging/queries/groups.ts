import { useUserId } from '@core/context/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { throwOnErr } from '@core/util/result';
import {
  invalidateListChannels,
  useChannelMetadataQuery,
} from '@queries/channel/channels';
import { queryReadyGate } from '@queries/gate';
import { useMetaBinding } from '@queries/meta-messaging';
import { metaMessagingKeys } from '@queries/meta-messaging/keys';
import type { MetaCreateGroup as CreateGroup } from '@service-storage/generated/schemas/metaCreateGroup';
import { metaMessagingClient } from '@service-storage/meta-messaging';
import { useMutation, useQueryClient } from '@tanstack/solid-query';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';

export function useCreateWhatsappGroup() {
  return useMutation(() => ({
    retry: false,
    mutationFn: (args: { connectionId: string; request: CreateGroup }) =>
      throwOnErr(() =>
        metaMessagingClient.createGroup(args.connectionId, args.request)
      ),
    onSettled: () => {
      void invalidateListChannels();
    },
  }));
}

export function useWhatsappGroup(channelId: Accessor<string>) {
  const client = useQueryClient();
  const metadata = useChannelMetadataQuery(channelId, () => true);
  const channel = () => (queryReadyGate(metadata) ? metadata.data : undefined);
  const user = useUserId();
  const binding = useMetaBinding(
    channelId,
    () => channel()?.messaging_binding === 'whatsapp_group'
  );
  const group = () =>
    queryReadyGate(binding) ? binding.data.group : undefined;
  const [link, setLink] = createSignal<string>();
  const [linkError, setLinkError] = createSignal(false);
  const [linkRequest, requestLink] = createSignal(0);
  // Capability URLs live only in this component owner. A mobile copy gesture
  // must call the native clipboard primitive before any network await.
  const accessScope = createMemo(
    () =>
      `${channelId()}:${user() ?? ''}:${!!group()?.can_copy_link && !binding.isError}`
  );
  createEffect(() => {
    accessScope();
    const id = channelId();
    const viewer = user();
    const allowed = accessScope().endsWith(':true');
    linkRequest();
    setLink(undefined);
    setLinkError(false);
    let current = true;
    onCleanup(() => {
      current = false;
      setLink(undefined);
    });
    if (!viewer || !allowed) return;
    void throwOnErr(() => metaMessagingClient.groupLink(id)).then(
      ({ invite_link }) => {
        if (current) setLink(invite_link);
      },
      () => {
        if (current) setLinkError(true);
      }
    );
  });
  const refresh = () => {
    void client.invalidateQueries({
      queryKey: metaMessagingKeys.conversation(channelId()).queryKey,
    });
  };
  const retry = useMutation(() => ({
    retry: false,
    mutationFn: () =>
      throwOnErr(() => metaMessagingClient.retryGroup(channelId())),
    onSettled: refresh,
  }));
  const copy = useMutation(() => ({
    gcTime: 0,
    mutationFn: async () => {
      const invite = link();
      if (!invite || !group()?.can_copy_link || binding.isError)
        throw new Error('Link unavailable');
      if (!(await writeClipboardData({ 'text/plain': invite })))
        throw new Error('Copy failed');
    },
  }));
  const remove = useMutation(() => ({
    retry: false,
    mutationFn: (participant: string) =>
      throwOnErr(() =>
        metaMessagingClient.removeGroupParticipant(channelId(), participant)
      ),
    onSettled: refresh,
  }));
  const destroy = useMutation(() => ({
    retry: false,
    mutationFn: async ({ id, discard }: { id: string; discard: boolean }) => {
      if (discard) await throwOnErr(() => metaMessagingClient.discardGroup(id));
      else await throwOnErr(() => metaMessagingClient.deleteGroup(id));
      return id;
    },
    onSuccess: (id) => {
      if (id === channelId()) setLink(undefined);
      void invalidateListChannels();
    },
  }));
  return {
    binding,
    group,
    linkReady: () => !!link(),
    linkError,
    refreshLink: () => requestLink((value) => value + 1),
    retry,
    copy,
    remove,
    destroy,
  };
}
