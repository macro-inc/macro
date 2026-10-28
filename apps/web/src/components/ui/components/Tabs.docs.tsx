import { defineDoc } from '@app/features/ui-gallery/types';
import ChatIcon from '@icon/system/regular/chat-text.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import PaperclipIcon from '@icon/system/regular/paperclip.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { createSignal, For } from 'solid-js';
import { Tabs, type TabsSize } from './Tabs';

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

// #region demo:sizes
function SizeRow(props: { size: TabsSize }) {
  const [view, setView] = createSignal<'messages' | 'files'>('messages');
  const [icon, setIcon] = createSignal<'messages' | 'files'>('messages');
  const options = [
    { value: 'messages', label: 'Messages', icon: ChatIcon },
    { value: 'files', label: 'Files', icon: PaperclipIcon },
  ] as const;
  return (
    <div class="flex flex-wrap items-center gap-3">
      <span class="w-6 font-mono text-xs text-ink-muted">{props.size}</span>
      <Tabs
        aria-label={`${props.size} view tabs`}
        size={props.size}
        options={options}
        value={view()}
        onChange={setView}
      />
      <Tabs
        aria-label={`${props.size} icon tabs`}
        size={props.size}
        iconOnly
        options={options}
        value={icon()}
        onChange={setIcon}
      />
    </div>
  );
}

function SizesDemo() {
  return (
    <div class="flex flex-col gap-3">
      <For each={['xs', 'sm', 'md', 'lg', 'xl'] as const}>
        {(size) => <SizeRow size={size} />}
      </For>
    </div>
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
    'The one inline single choice: switch a view, a section, or a small set of values. Desktop view tabs share one rounded track with an inset selected pill.',
  status: 'stable',
  exports: ['Tabs'],
  import: "import { Tabs } from '@ui';",
  propTypes: ['TabsProps', 'TabOption'],
  demos: [
    {
      id: 'view',
      title: 'View tabs',
      description:
        'Header view tabs sit after the title, left of the controls. The choices share a flat rounded track with an inset selected pill, sized to match neighbouring controls.',
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
      id: 'sizes',
      title: 'Sizes',
      description:
        'Tabs share Button minimum heights and square icon sizes. Medium labels use 14px text and 12px horizontal padding; large labels use 15px text. Touch treatments retain their minimum targets.',
      render: SizesDemo,
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
        '`variant="track"` slides one flat pill along a filled track on every device. It is only for the agent composer\'s Chat/Code switch in the composer tray.',
      render: TrackDemo,
    },
  ],
});
