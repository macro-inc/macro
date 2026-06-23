import { ReadonlyThread } from '@channel/StandaloneThread';
import type { WidgetOf } from '../schema';

export type ChannelMessageProps = Omit<WidgetOf<'channelMessage'>, 'type'>;

export function ChannelMessage(props: ChannelMessageProps) {
  return (
    <ReadonlyThread channelId={props.channelId} messageId={props.messageId} />
  );
}
