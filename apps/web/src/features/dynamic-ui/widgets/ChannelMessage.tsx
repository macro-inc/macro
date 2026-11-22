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
 * The caption without its mention of the channel, which heads the card, when
 * the mention ends or starts it: "Pricing decisions in #launch-planning"
 * keeps "Pricing decisions". A mention mid-sentence ("What #general decided")
 * stays, so the title still reads. Only a whole-word mention counts ("dev",
 * not "devs"). Empty when nothing is left.
 */
function withoutChannel(caption: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundary = '[^\\p{L}\\p{N}_-]';
  return caption
    .replace(
      new RegExp(
        `(^|${boundary})(?:(?:in|from|on)\\s+)?#?${escaped}\\s*$`,
        'iu'
      ),
      '$1'
    )
    .replace(new RegExp(`^\\s*#?${escaped}(?=$|${boundary})`, 'iu'), '')
    .replace(/^[\s:,–—-]+|[\s:,–—-]+$/g, '');
}

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
  // The channel already heads the card, so the view title drops its mention
  // of it; a title that was only that ("Thread in #…") reads "Thread".
  const caption = () => {
    const name = channelName();
    const rest =
      props.caption !== undefined && name !== undefined
        ? withoutChannel(props.caption, name)
        : props.caption;
    return rest && rest.toLowerCase() !== 'thread'
      ? rest
      : t('agentCards.channelThread');
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
            <UiCard.Description>{caption()}</UiCard.Description>
          </Item.Content>
          <Item.Actions>
            {/* On a phone the label gives way to the channel name: an icon
                button, still named for screen readers and by its tooltip. */}
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('agentCards.openInChannel')}
              // Beside the button: below it, it covered the first message's time.
              tooltip={{
                content: t('agentCards.openInChannel'),
                placement: 'left',
              }}
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
