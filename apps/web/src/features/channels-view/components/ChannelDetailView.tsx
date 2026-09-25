import { getChannelEntityTarget } from '@app/features/next-soup/utils';
import {
  ChannelDetail,
  ChannelDetailTopBar,
} from '@channel/Channel/ChannelDetail';
import type { ChannelTargetRequest } from '@channel/Channel/ChannelSurface';
import type { ChannelEntity } from '@entity';
import { createMemo } from 'solid-js';

/**
 * Rail-selection adapter for the shared ChannelDetail. Fresh metadata and
 * notifications reconcile into a replacement entity for the same selection;
 * only a channel switch or an explicit target change re-derives the target,
 * so notification reads never re-navigate an open conversation (PreviewPanel
 * applied the same rule via its stringified navigation key).
 */
export function ChannelDetailView(props: { channel: ChannelEntity }) {
  let lastTargetKey: string | undefined;
  const target = createMemo<ChannelTargetRequest | undefined>((previous) => {
    const key = `${props.channel.id}:${props.channel.target?.messageId ?? ''}:${
      props.channel.target?.threadId ?? ''
    }`;
    if (lastTargetKey !== undefined && key === lastTargetKey) return previous;
    lastTargetKey = key;
    const clickTarget = getChannelEntityTarget(props.channel);
    if (!clickTarget) return undefined;
    return clickTarget.kind === 'latest'
      ? { kind: 'latest' }
      : {
          kind: 'message',
          messageId: clickTarget.messageId,
          threadId: clickTarget.threadId,
        };
  });

  return (
    <ChannelDetail
      channelId={props.channel.id}
      target={target()}
      fallbackName={props.channel.name}
      autofocus={false}
    >
      {(channel) => (
        <ChannelDetailTopBar
          channelId={channel.channelId}
          fallbackName={props.channel.name}
        />
      )}
    </ChannelDetail>
  );
}
