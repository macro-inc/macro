import { defineDoc } from '@app/features/ui-gallery/types';
import ChatIcon from '@phosphor/chat-text.svg';
import CodeIcon from '@phosphor/code.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import UsersIcon from '@phosphor/users.svg';
import { createSignal } from 'solid-js';
import { Tabs } from './Tabs';

// #region demo:view
function ViewDemo() {
  const [value, setValue] = createSignal<'overview' | 'activity' | 'files'>(
    'overview'
  );
  return (
    <Tabs
      aria-label="Project sections"
      options={[
        { value: 'overview', label: 'Overview' },
        { value: 'activity', label: 'Activity' },
        { value: 'files', label: 'Files' },
      ]}
      value={value()}
      onChange={setValue}
    />
  );
}
// #endregion

// #region demo:counts
function CountsDemo() {
  const [value, setValue] = createSignal<'upcoming' | 'past' | 'canceled'>(
    'upcoming'
  );
  return (
    <Tabs
      aria-label="Booking status"
      options={[
        { value: 'upcoming', label: 'Upcoming', count: 12 },
        { value: 'past', label: 'Past', count: 48 },
        { value: 'canceled', label: 'Canceled', count: 3 },
      ]}
      value={value()}
      onChange={setValue}
    />
  );
}
// #endregion

// #region demo:icon-only
function IconOnlyDemo() {
  const [value, setValue] = createSignal<'messages' | 'files' | 'people'>(
    'messages'
  );
  return (
    <Tabs
      aria-label="Channel sections"
      iconOnly
      options={[
        { value: 'messages', label: 'Messages', icon: ChatIcon },
        { value: 'files', label: 'Attachments', icon: PaperclipIcon },
        { value: 'people', label: 'Participants', icon: UsersIcon },
      ]}
      value={value()}
      onChange={setValue}
    />
  );
}
// #endregion

// #region demo:value
function ValueDemo() {
  const [value, setValue] = createSignal<'team' | 'personal'>('team');
  return (
    <div class="w-64">
      <Tabs
        aria-label="Owner"
        size="sm"
        fullWidth
        options={[
          { value: 'team', label: 'Team' },
          { value: 'personal', label: 'Personal' },
        ]}
        value={value()}
        onChange={setValue}
      />
    </div>
  );
}
// #endregion

// #region demo:track
function TrackDemo() {
  const [value, setValue] = createSignal<'chat' | 'code'>('chat');
  return (
    <Tabs
      aria-label="Conversation mode"
      variant="track"
      fullWidth
      options={[
        { value: 'chat', label: 'Chat', icon: ChatIcon },
        { value: 'code', label: 'Code', icon: CodeIcon },
      ]}
      value={value()}
      onChange={setValue}
      class="w-56"
    />
  );
}
// #endregion

export default defineDoc({
  name: 'Tabs',
  category: 'Navigation',
  description:
    'The one inline single choice: switch a view, a section, or a small set of values. Each option is its own pill; the selected one takes the pressed fill.',
  status: 'stable',
  exports: ['Tabs'],
  import: "import { Tabs } from '@ui';",
  propTypes: ['TabsProps', 'TabOption'],
  demos: [
    {
      id: 'view',
      title: 'View tabs',
      description:
        'Header view tabs sit after the title, left of the controls. Unselected pills share the outline Button frame at the same height as their neighbours.',
      render: ViewDemo,
    },
    {
      id: 'counts',
      title: 'Counts',
      description: 'Counts follow the label in muted figures.',
      render: CountsDemo,
    },
    {
      id: 'icon-only',
      title: 'Icon only',
      description:
        'A narrow header collapses labels to icons. Each label stays the accessible name and becomes the tooltip.',
      render: IconOnlyDemo,
    },
    {
      id: 'value',
      title: 'Choosing a value',
      description:
        'In forms and dialogs, `fullWidth` gives equal-width options and `size="sm"` matches compact rows.',
      render: ValueDemo,
    },
    {
      id: 'track',
      title: 'Composer mode switch',
      description:
        '`variant="track"` slides one raised pill along a filled track on every device. It is only for the agent composer\'s Chat/Code switch in the composer tray.',
      render: TrackDemo,
    },
  ],
});
