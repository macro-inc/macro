import { ViewSidebar } from '@app/components/view-shell';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { runCreateAction } from '@app/features/command/Launcher';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { enableChatSidebarSections } from '@core/constant/featureFlags';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Dropdown } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { Show } from 'solid-js';
import { CHANNELS_TOUR } from '../tour';

/** Channel, direct-message, and section creation in the Chat navigation. */
export function ConversationsCreateMenu(props: {
  presentation?: 'sidebar' | 'toolbar';
  onCreateSection?: () => void;
  sectionDisabledReason?: string;
}) {
  const sections = useFeatureFlag(enableChatSidebarSections);
  const label = () => t('channelSections.createChannelOrDirectMessage');
  let creatingSection = false;

  return (
    <Dropdown
      sameWidth={props.presentation === 'sidebar'}
      placement={
        props.presentation === 'sidebar' ? 'bottom-start' : 'bottom-end'
      }
    >
      <Show
        when={props.presentation}
        fallback={
          <Dropdown.Trigger
            as={ViewSidebar.Control}
            aria-label={label()}
            tooltip={label()}
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
          aria-label={label()}
        />
      </Show>
      <Dropdown.Content
        class="min-w-48"
        onCloseAutoFocus={(event) => {
          if (creatingSection) {
            creatingSection = false;
            props.onCreateSection?.();
            event.preventDefault();
          } else if (document.querySelector('[role="dialog"]')) {
            event.preventDefault();
          }
        }}
      >
        <Dropdown.Group>
          <Dropdown.Item onSelect={openNewChannelModal}>
            <HashIcon class="size-3.5 shrink-0 text-ink-muted" />
            {t('channelSections.newChannel')}
          </Dropdown.Item>
          <Dropdown.Item onSelect={() => runCreateAction('channel')}>
            <ChatIcon class="size-3.5 shrink-0 text-ink-muted" />
            {t('channelSections.newDirectMessage')}
          </Dropdown.Item>
        </Dropdown.Group>
        <Show when={sections().enabled && props.onCreateSection}>
          <Dropdown.Group>
            <Dropdown.Item
              disabledReason={props.sectionDisabledReason}
              onSelect={() => {
                creatingSection = true;
              }}
            >
              {t('channelSections.newSection')}
            </Dropdown.Item>
          </Dropdown.Group>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
