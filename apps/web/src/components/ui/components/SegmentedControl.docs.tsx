import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { SegmentedControl } from './SegmentedControl';
import { TabsInset } from './TabsInset';

// #region demo:basic
function SegmentedDemo() {
  const [value, setValue] = createSignal('list');
  return (
    <SegmentedControl
      aria-label="View mode"
      value={value()}
      onChange={setValue}
      options={[
        { value: 'list', label: 'List' },
        { value: 'board', label: 'Board' },
        { value: 'calendar', label: 'Calendar', disabled: true },
      ]}
    />
  );
}

// #endregion

// #region demo:inset
function InsetDemo() {
  const [value, setValue] = createSignal('messages');
  return (
    <TabsInset
      aria-label="Channel view"
      value={value()}
      onChange={setValue}
      list={[
        { value: 'messages', label: 'Messages' },
        { value: 'attachments', label: 'Attachments' },
        { value: 'calls', label: 'Calls' },
        { value: 'people', label: 'People' },
      ]}
    />
  );
}

// #endregion

export default defineDoc({
  name: 'Segmented Control',
  category: 'Inputs',
  description:
    'A quiet inset track with a single raised selection that glides between options. Respects reduced motion and retains native radio keyboard behavior.',
  status: 'stable',
  exports: ['TabsInset', 'SegmentedControl'],
  import: "import { TabsInset, SegmentedControl } from '@ui';",
  demos: [
    { id: 'basic', title: 'View mode', render: SegmentedDemo },
    { id: 'inset', title: 'Channel tabs', render: InsetDemo },
  ],
});
