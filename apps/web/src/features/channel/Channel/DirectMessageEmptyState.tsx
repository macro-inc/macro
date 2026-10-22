import EmptyStateChannelsGraphic from '@design/empty-state-channels.svg';
import { EmptyStatePanel } from '@ui/components/EmptyStatePanel';

export function DirectMessageEmptyState() {
  return (
    <EmptyStatePanel
      centered
      graphic={EmptyStateChannelsGraphic}
      graphicClass="size-40 sm:size-48"
      title="Say hello"
      description="Send a message to start the conversation. If they’re not on Macro yet, they’ll receive your message by email right away."
      descriptionClass="max-w-sm text-balance"
      topSpacerClass="basis-0 mobile:basis-0 grow"
      class="min-h-0 px-6 @4xl:px-6"
    />
  );
}
