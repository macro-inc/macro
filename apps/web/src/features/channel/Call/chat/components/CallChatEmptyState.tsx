import { t } from '@app/lib/i18n';
import EmptyStateCallChatGraphic from '@design/empty-state-call-chat.svg';
import { EmptyStatePanel } from '@ui/components/EmptyStatePanel';

export function CallChatEmptyState() {
  return (
    <EmptyStatePanel
      centered
      graphic={EmptyStateCallChatGraphic}
      description={t('calls.emptyChat')}
      topSpacerClass="basis-0 grow"
      class="min-h-48 px-4 pb-4 touch:pt-0"
    />
  );
}
