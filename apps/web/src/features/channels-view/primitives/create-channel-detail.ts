import { isAccessRequestError } from '@core/util/request-error';
import type { ChannelEntity } from '@entity/types/entity';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createEffect, createMemo, on } from 'solid-js';
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
  markRead: (channel: ChannelEntity) => void;
}) {
  // `on` tracks reads; it does not compare the values returned by its sources.
  // Memoize the fields so replacing a selection object is not a new open/jump.
  const channelId = createMemo(() => options.selection()?.id);
  const activation = createMemo(on(channelId, () => ({})));
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
    // Only a refusal means no access. Any other failure, including a GraphQL
    // error from a server fault, keeps the open channel or offers a retry.
    if (load.status === 'error' && isAccessRequestError(load.error))
      return { status: 'unavailable', channelId: id, denied: true };
    if (load.status === 'ready') {
      const channel = complete();
      return channel
        ? { status: 'ready', channel }
        : { status: 'unavailable', channelId: id, denied: false };
    }
    // Pending revalidation cannot undo a confirmed absence or access failure.
    if (previous?.status === 'unavailable' && previous.channelId === id)
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

  // Record each move into an unavailable state with what caused it: denied
  // (a refusal), a ready load (the server returned no channel), or an error.
  createEffect(
    on(view, (current, previous) => {
      if (current.status !== 'unavailable') return;
      // A confirmed absence is rebuilt on every refetch; log it once.
      if (
        previous?.status === 'unavailable' &&
        previous.channelId === current.channelId &&
        previous.denied === current.denied
      )
        return;
      Telemetry.warn('channel.detail.unavailable', {
        'channel.id': current.channelId,
        'channel.detail.denied': current.denied,
        'channel.detail.load_status': options.source.load().status,
      });
    })
  );

  // Conversation opens always start at latest; only explicit links pick a message.
  const target = createMemo<ChannelDestination>(() => {
    const explicit = options.selection()?.target;
    return explicit ? { kind: 'message', ...explicit } : { kind: 'latest' };
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
    target,
    refresh: options.source.refresh,
  };
}
