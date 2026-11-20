import { ReadonlyThread } from '@channel/StandaloneThread';
import { openThreadMessage } from '@channel/StandaloneThread/open-thread-message';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { EntityIcon } from '@core/component/EntityIcon';
import { useChannelName } from '@core/context/channels';
import { Button, Item, Card as UiCard } from '@ui';
import { Card, CardBody } from '../../agent-cards/components/kit/card';
import type { WidgetOf } from '../view';

export type ChannelMessageProps = Omit<WidgetOf<'channelMessage'>, 'type'>;

/**
 * A channel thread the agent shows: which channel it is from, a way to open
 * it there, and the thread, where a click opens that message in the channel.
 */
export function ChannelMessage(props: ChannelMessageProps) {
  const orchestrator = useGlobalBlockOrchestrator();
  const channelName = useChannelName(props.channelId, 'Channel');
  const open = (messageId: string) =>
    openThreadMessage(
      orchestrator,
      {
        channelId: props.channelId,
        threadMessageId: props.messageId,
        messageId,
      },
      'dynamic-ui-channel-message'
    );
  return (
    <Card width="standard" data-agent-card="channel-message">
      <UiCard.Header>
        <Item class="gap-3 border-0 p-0">
          <Item.Media class="self-center">
            <EntityIcon targetType="channel" size="sm" />
          </Item.Media>
          <Item.Content class="gap-0">
            <UiCard.Title class="truncate">{channelName()}</UiCard.Title>
            <UiCard.Description>Thread</UiCard.Description>
          </Item.Content>
          <Item.Actions>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => open(props.messageId)}
            >
              Open in channel
            </Button>
          </Item.Actions>
        </Item>
      </UiCard.Header>
      <CardBody tight>
        <ReadonlyThread
          channelId={props.channelId}
          messageId={props.messageId}
          onClickMessage={(messageId, e) => {
            e.stopPropagation();
            open(messageId);
          }}
        />
      </CardBody>
    </Card>
  );
}
