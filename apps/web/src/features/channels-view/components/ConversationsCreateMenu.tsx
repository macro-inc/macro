import { ViewSidebar } from '@app/components/view-shell';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import PlusIcon from '@icon/system/regular/plus.svg';
import { tourTarget } from '@ui/components/Tour';
import { Show } from 'solid-js';
import { CHANNELS_TOUR } from '../tour';
import { openNewConversationDialog } from './NewConversationDialog';

/** One entry point for finding or starting channels and direct messages. */
export function ConversationsCreateMenu(props: {
  presentation?: 'sidebar' | 'toolbar';
}) {
  return (
    <Show
      when={props.presentation}
      fallback={
        <ViewSidebar.Control
          aria-label={t('channelSections.newConversation')}
          tooltip={t('channelSections.newConversation')}
          onClick={openNewConversationDialog}
        >
          <PlusIcon class="size-3.5" />
        </ViewSidebar.Control>
      }
    >
      <ViewCreateButton
        ref={tourTarget(CHANNELS_TOUR.create)}
        presentation={props.presentation}
        aria-label={t('channelSections.newConversation')}
        onClick={openNewConversationDialog}
      />
    </Show>
  );
}
