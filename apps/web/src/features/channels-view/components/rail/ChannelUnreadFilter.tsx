import EmptyStateChannelsGraphic from '@design/empty-state-channels.svg';
import { EmptyStatePanel } from '@ui';
import { useChannelsRail } from './ChannelsRailContext';

/** Shown in place of a list the Unread filter has emptied. */
export function ChannelUnreadEmptyState() {
  const rail = useChannelsRail();

  return (
    <EmptyStatePanel
      centered
      graphic={EmptyStateChannelsGraphic}
      graphicClass="aspect-square h-auto w-[clamp(12rem,70%,18rem)] self-center"
      title="No unread conversations"
      description="You're all caught up."
      descriptionClass="mt-1 text-balance"
      actionsClass="mt-5 flex-row @max-sm:flex-row"
      primaryAction={{
        label: 'Show all',
        onClick: () => rail.setUnreadOnly(false),
      }}
      class="px-4 pt-4 @4xl:px-4 [&>div:first-child]:basis-0"
    />
  );
}
