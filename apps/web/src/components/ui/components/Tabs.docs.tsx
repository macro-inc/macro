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
        {
          value: 'overview',
          label: 'Overview',
          tooltip: 'Project summary and key information',
        },
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

// #region demo:full-width-icons
function FullWidthIconsDemo() {
  const [value, setValue] = createSignal<'chat' | 'code'>('chat');
  return (
    <div class="w-48">
      <Tabs
        aria-label="Conversation mode"
        fullWidth
        iconOnly
        options={[
          { value: 'chat', label: 'Chat', icon: ChatIcon, dot: true },
          { value: 'code', label: 'Code', icon: CodeIcon },
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

// #region demo:choices
function ChoicesDemo() {
  const [value, setValue] = createSignal<'event' | 'away'>('event');
  return (
    // Choice faces are 24px on desktop and 28px inside 44px touch targets.
    <Tabs
      aria-label="Event type"
      variant="choices"
      wrap
      options={[
        { value: 'event', label: 'Event' },
        { value: 'away', label: 'Out of office' },
      ]}
      value={value()}
      onChange={setValue}
    />
  );
}
// #endregion

// #region demo:filled-choices
function FilledChoicesDemo() {
  const [value, setValue] = createSignal<'event' | 'away'>('event');
  return (
    <Tabs
      aria-label="Filled event type"
      variant="choices-filled"
      options={[
        { value: 'event', label: 'Event' },
        { value: 'away', label: 'Out of office' },
      ]}
      value={value()}
      onChange={setValue}
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
        'Header view tabs sit after the title, left of the controls. Optional desktop pill tooltips explain a label on hover or input focus without renaming it; the explanation remains an accessible description on touch. The choices share a flat rounded track with an inset selected pill, sized to match neighbouring controls.',
      render: ViewDemo,
    },
    {
      id: 'choices',
      title: 'Form choices',
      description:
        'Separate 24px choice faces use 12px text; touch keeps 28px faces inside 44px targets.',
      render: ChoicesDemo,
    },
    {
      id: 'filled-choices',
      title: 'Filled form choices',
      description:
        'Separate 28px choices pair solid accent selection with its foreground token. Radio and keyboard behavior stays shared.',
      render: FilledChoicesDemo,
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
        'A narrow header collapses labels to icons. Each option keeps an inset square inside the grouped track; its label stays the accessible name and becomes the tooltip.',
      render: IconOnlyDemo,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      description:
        'Tabs share Button minimum heights and square icon sizes. Medium labels use 14px text and 12px horizontal padding; large labels use 15px text. Touch treatments retain their minimum targets. `size="composer"` with the inset treatment matches repository controls: 38px frame, 36px items, 14px text with the adjacent control’s inherited line height, 8px label padding, and full rounding.',
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
      id: 'full-width-icons',
      title: 'Full width, icon only',
      description:
        'With `fullWidth`, icon-only options still share the row equally, and a dot sits on its glyph’s corner.',
      render: FullWidthIconsDemo,
    },
    {
      id: 'track',
      title: 'Legacy track reference',
      description:
        '`variant="track"` preserves Home’s existing composer tabs. Other production Auto/Chat/Code switches use the shared grouped Tabs pill.',
      render: TrackDemo,
    },
  ],
});
