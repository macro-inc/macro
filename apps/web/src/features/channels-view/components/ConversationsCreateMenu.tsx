import { ViewSidebar } from '@app/components/view-shell';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Dropdown } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { Show } from 'solid-js';
import { CHANNELS_TOUR } from '../tour';
import { openNewConversationDialog } from './NewConversationDialog';

/** The shared creation menu for conversations, named channels, and sections. */
export function ConversationsCreateMenu(props: {
  presentation?: 'sidebar' | 'toolbar';
  onCreateSection?: () => void;
  sectionDisabledReason?: string;
}) {
  return (
    <Dropdown placement="bottom-start">
      <Show
        when={props.presentation}
        fallback={
          <Dropdown.Trigger
            as={ViewSidebar.Control}
            aria-label={t('channelSections.newConversation')}
            tooltip={t('channelSections.newConversation')}
          >
            <PlusIcon class="size-3.5" />
          </Dropdown.Trigger>
        }
      >
        <Dropdown.Trigger
          as={ViewCreateButton}
          ref={tourTarget(CHANNELS_TOUR.create)}
          presentation={props.presentation}
          menu
          aria-label={t('channelSections.newConversation')}
        />
      </Show>
      <Dropdown.Content
        class="min-w-48"
        onCloseAutoFocus={(event) => {
          if (document.querySelector('[role="dialog"]')) event.preventDefault();
        }}
      >
        <Dropdown.Item onSelect={openNewConversationDialog}>
          {t('channelSections.newConversation')}
        </Dropdown.Item>
        <Dropdown.Item onSelect={() => openNewChannelModal()}>
          {t('channelSections.createChannel')}
        </Dropdown.Item>
        <Show when={props.onCreateSection}>
          <Dropdown.Separator />
          <Dropdown.Item
            disabledReason={props.sectionDisabledReason}
            onSelect={() => props.onCreateSection?.()}
          >
            {t('channelSections.newSection')}
          </Dropdown.Item>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
