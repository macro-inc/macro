import { isTransientRequestError } from '@core/util/request-error';
import type { ChannelEntity } from '@entity/types/entity';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import type {
  ChannelDestination,
  ChannelDetailSource,
  ChannelSelection,
} from '../context/channel-detail-source';

type ChannelDetailViewState =
  | { status: 'loading' }
  | { status: 'unavailable'; channelId: string; denied: boolean }
  | { status: 'ready'; channel: ChannelEntity };

/** Display, initial navigation, and read marking have independent readiness. */
export function createChannelDetail(options: {
  selection: Accessor<ChannelSelection | undefined>;
  cached: Accessor<ChannelEntity | undefined>;
  source: ChannelDetailSource;
  resolveDestination: (
    channel: ChannelEntity
  ) => ChannelDestination | undefined;
  markRead: (channel: ChannelEntity) => void;
}) {
  // `on` tracks reads; it does not compare the values returned by its sources.
  // Memoize the fields so replacing a selection object is not a new open/jump.
  const channelId = createMemo(() => options.selection()?.id);
  const messageId = createMemo(() => options.selection()?.target?.messageId);
  const threadId = createMemo(() => options.selection()?.target?.threadId);
  const activation = createMemo(on(channelId, () => ({})));
  const navigation = createMemo(
    on([activation, messageId, threadId], () => ({}))
  );
  const [interrupted, setInterrupted] = createSignal<object>();
  const complete = () => {
    const load = options.source.load();
    return load.status === 'ready' && load.channel?.id === channelId()
      ? load.channel
      : undefined;
  };

  const view = createMemo<ChannelDetailViewState>((previous) => {
    const id = channelId();
    if (!id) return { status: 'loading' };
    const load = options.source.load();
    if (load.status === 'error' && !isTransientRequestError(load.error))
      return { status: 'unavailable', channelId: id, denied: true };
    if (load.status === 'ready') {
      const channel = complete();
      return channel
        ? { status: 'ready', channel }
        : { status: 'unavailable', channelId: id, denied: false };
    }
    // Retrying an access failure cannot make previously denied data visible.
    if (
      previous?.status === 'unavailable' &&
      previous.channelId === id &&
      previous.denied
    )
      return previous;
    const cached = options.cached();
    const channel =
      previous?.status === 'ready' && previous.channel.id === id
        ? previous.channel
        : cached?.id === id
          ? cached
          : undefined;
    if (channel) return { status: 'ready', channel };
    return load.status === 'error'
      ? { status: 'unavailable', channelId: id, denied: false }
      : { status: 'loading' };
  });

  const destination = createMemo<{
    navigation: object;
    settled: boolean;
    target: ChannelDestination | undefined;
  }>((previous) => {
    const request = navigation();
    if (previous?.navigation === request && previous.settled) return previous;
    const explicit = options.selection()?.target;
    if (explicit)
      return {
        navigation: request,
        settled: true,
        target: { kind: 'message', ...explicit },
      };
    // Once the user takes control, or a failed lookup opens at latest, a late
    // response may update read state but must not move the conversation.
    if (
      interrupted() === request ||
      (options.source.load().status === 'error' && view().status === 'ready')
    )
      return { navigation: request, settled: true, target: undefined };
    const channel = complete();
    return {
      navigation: request,
      settled: channel !== undefined,
      target: channel ? options.resolveDestination(channel) : undefined,
    };
  });

  let markedActivation: object | undefined;
  createEffect(() => {
    const current = activation();
    const channel = complete();
    if (
      !channel ||
      markedActivation === current ||
      channel.isParticipant === false
    )
      return;
    markedActivation = current;
    options.markRead(channel);
  });

  return {
    view,
    target: () => destination().target,
    onInteraction: () => setInterrupted(navigation()),
    refresh: options.source.refresh,
  };
}
