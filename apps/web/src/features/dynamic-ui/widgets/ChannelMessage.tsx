import { t } from '@app/lib/i18n';
import { channelListName } from '@channel/group-chat-name';
import { ReadonlyThread } from '@channel/StandaloneThread';
import { openThreadMessage } from '@channel/StandaloneThread/open-thread-message';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { EntityIcon, getEntityIconType } from '@core/component/EntityIcon';
import { useChannelName, useChannelType } from '@core/context/channels';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import { Button, Item, Card as UiCard } from '@ui';
import { Card, CardBody } from '../../agent-cards/components/kit/card';
import type { WidgetOf } from '../view';

export type ChannelMessageProps = Omit<WidgetOf<'channelMessage'>, 'type'> & {
  /** The view's title, shown in place of "Thread" so it appears once. */
  caption?: string;
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
          <Item.Content class="min-w-0 gap-0">
            <UiCard.Title class="truncate">{title()}</UiCard.Title>
            <UiCard.Description>
              {props.caption ?? t('agentCards.channelThread')}
            </UiCard.Description>
          </Item.Content>
          <Item.Actions>
            {/* On a phone the label gives way to the channel name: an icon
                button, still named for screen readers and by its tooltip. */}
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('agentCards.openInChannel')}
              tooltip={t('agentCards.openInChannel')}
              onClick={() => open(props.messageId)}
            >
              <ArrowSquareOutIcon class="size-4 sm:hidden" aria-hidden="true" />
              <span class="max-sm:hidden">{t('agentCards.openInChannel')}</span>
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
