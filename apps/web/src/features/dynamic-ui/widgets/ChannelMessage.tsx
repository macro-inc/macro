import { t } from '@app/lib/i18n';
import { channelListName } from '@channel/group-chat-name';
import { ReadonlyThread } from '@channel/StandaloneThread';
import { openThreadMessage } from '@channel/StandaloneThread/open-thread-message';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { EntityIcon, getEntityIconType } from '@core/component/EntityIcon';
import { useChannelName, useChannelType } from '@core/context/channels';
import { Button, Item, Card as UiCard } from '@ui';
import { Show } from 'solid-js';
import { Card, CardBody } from '../../agent-cards/components/kit/card';
import type { WidgetOf } from '../view';

export type ChannelMessageProps = Omit<
  WidgetOf<'channelMessage'>,
  'type' | 'title'
> & {
  /** The view's title, handed to a lone card so it shows once. */
  title?: string;
};

/**
 * A channel thread the agent shows: which channel it is from, a way to open
 * it there, and the thread, where a click opens that message in the channel.
 */
export function ChannelMessage(props: ChannelMessageProps) {
  const orchestrator = useGlobalBlockOrchestrator();
  // The fallback is read at render so it follows the interface language.
  const channelName = useChannelName(props.channelId);
  const channelType = useChannelType(props.channelId);
  // Named and drawn as the channel list does: a group chat's long list of
  // people is shortened, and a DM or private chat gets its own icon.
  const title = () => {
    if (props.title) return props.title;
    const name = channelName();
    return name === undefined
      ? t('agentCards.channelFallback')
      : channelListName({ name, channelType: channelType() });
  };
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
    <Card width="full" data-agent-card="channel-message">
      <UiCard.Header>
        <Item class="gap-3 border-0 p-0">
          <Item.Media class="self-center">
            <EntityIcon
              targetType={getEntityIconType({
                type: 'channel',
                channelType: channelType(),
              })}
              size="sm"
            />
          </Item.Media>
          <Item.Content class="gap-0">
            <UiCard.Title class="truncate">{title()}</UiCard.Title>
            <Show when={!props.title}>
              <UiCard.Description>
                {t('agentCards.channelThread')}
              </UiCard.Description>
            </Show>
          </Item.Content>
          <Item.Actions>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => open(props.messageId)}
            >
              {t('agentCards.openInChannel')}
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
