import { ViewSidebar } from '@app/components/view-shell';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { runCreateAction } from '@app/features/command/Launcher';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import ChatCircleIcon from '@phosphor/chat-circle.svg';
import HashIcon from '@phosphor/hash.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';

/** Channel and direct-message creation in the Chat navigation. */
export function ConversationsCreateMenu(props: {
  presentation?: 'sidebar' | 'toolbar';
}) {
  return (
    <Dropdown
      placement={
        props.presentation === 'sidebar' ? 'bottom-start' : 'bottom-end'
      }
    >
      <Show
        when={props.presentation}
        fallback={
          <Dropdown.Trigger
            as={ViewSidebar.Control}
            variant="ghost"
            size="icon-sm"
            label="Create channel or direct message"
          >
            <PlusIcon class="size-3.5" />
          </Dropdown.Trigger>
        }
      >
        <Dropdown.Trigger
          as={ViewCreateButton}
          presentation={props.presentation}
          menu
          aria-label="Create channel or direct message"
        />
      </Show>
      <Dropdown.Content class="min-w-44">
        <Dropdown.Group>
          <Dropdown.Item onSelect={openNewChannelModal}>
            <HashIcon class="size-3.5 shrink-0 text-ink-muted" />
            <span>New channel</span>
          </Dropdown.Item>
          <Dropdown.Item onSelect={() => runCreateAction('channel')}>
            <ChatCircleIcon class="size-3.5 shrink-0 text-ink-muted" />
            <span>New direct message</span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
