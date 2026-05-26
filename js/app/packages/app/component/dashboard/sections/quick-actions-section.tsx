import { useSplitLayout } from '@app/component/split-layout/layout';
import { setCreateMenuOpen } from '@app/component/Launcher';
import PlusIcon from '@phosphor/plus.svg';
import LightningIcon from '@phosphor/lightning.svg';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import CalendarIcon from '@phosphor/calendar.svg';
import FolderIcon from '@phosphor/folder.svg';
import UsersIcon from '@phosphor/users.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Button } from '@ui';

export function QuickActionsSection() {
  const { openWithSplit } = useSplitLayout();

  const handleNewAutomation = () => {
    openWithSplit({ type: 'automation', id: 'new' });
  };

  const handleSendEmail = () => {
    openWithSplit({ type: 'component', id: 'mail' });
  };

  const handleNewProject = () => {
    openWithSplit({ type: 'project', id: 'new' });
  };

  const handleNewChannel = () => {
    openWithSplit({ type: 'component', id: 'channels' });
  };

  const handleSchedule = () => {
    openWithSplit({ type: 'component', id: 'calendar' });
  };

  return (
    <div class="flex items-center gap-2">
      <Button
        variant="cta"
        size="md"
        onClick={() => setCreateMenuOpen(true)}
        class="gap-1.5"
      >
        <PlusIcon class="size-4" />
        <span>Create</span>
      </Button>

      <Button
        variant="ghost"
        size="md"
        onClick={handleNewAutomation}
        class="gap-1.5"
      >
        <LightningIcon class="size-4" />
        <span>New Automation</span>
      </Button>

      <DropdownMenu>
        <DropdownMenu.Trigger
          as={Button}
          variant="ghost"
          size="icon-md"
        >
          <DotsThreeIcon class="size-5" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="z-50 min-w-48 bg-surface border border-edge rounded-lg shadow-lg py-1 animate-in fade-in-0 zoom-in-95">
            <DropdownMenu.Item
              onSelect={handleSendEmail}
              class="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-ink/5 cursor-default outline-none"
            >
              <EnvelopeIcon class="size-4 text-ink-muted" />
              <span>Send email</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={handleNewProject}
              class="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-ink/5 cursor-default outline-none"
            >
              <FolderIcon class="size-4 text-ink-muted" />
              <span>New project</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={handleNewChannel}
              class="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-ink/5 cursor-default outline-none"
            >
              <UsersIcon class="size-4 text-ink-muted" />
              <span>New channel</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={handleSchedule}
              class="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-ink/5 cursor-default outline-none"
            >
              <CalendarIcon class="size-4 text-ink-muted" />
              <span>Schedule</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  );
}
