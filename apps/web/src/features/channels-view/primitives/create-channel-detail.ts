import { isTransientRequestError } from '@core/util/request-error';
import type { ChannelEntity } from '@entity/types/entity';
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
