import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal, For } from 'solid-js';
import { RadioGroup } from './RadioGroup';

const SCOPE_OPTIONS = [
  { value: 'this_event', label: 'This event' },
  { value: 'this_and_following', label: 'This and following events' },
  { value: 'all', label: 'All events' },
];

// #region demo:basic
function BasicDemo() {
  const [value, setValue] = createSignal('this_event');

  return (
    <RadioGroup
      value={value()}
      onChange={setValue}
      aria-label="Apply changes to"
      class="text-sm text-ink"
    >
      <For each={SCOPE_OPTIONS}>
        {(option) => (
          <RadioGroup.Item value={option.value}>
            <RadioGroup.ItemControl />
            <RadioGroup.ItemLabel>{option.label}</RadioGroup.ItemLabel>
          </RadioGroup.Item>
        )}
      </For>
    </RadioGroup>
  );
}
// #endregion

// #region demo:horizontal
function HorizontalDemo() {
  return (
    <RadioGroup
      defaultValue="this_event"
      aria-label="Apply changes to"
      class="flex-row items-center gap-3 text-xs text-ink-muted"
    >
      <RadioGroup.Item value="this_event" class="gap-1.5">
        <RadioGroup.ItemControl class="size-3.5" />
        <RadioGroup.ItemLabel>This event</RadioGroup.ItemLabel>
      </RadioGroup.Item>
      <RadioGroup.Item value="all" class="gap-1.5">
        <RadioGroup.ItemControl class="size-3.5" />
        <RadioGroup.ItemLabel>All events</RadioGroup.ItemLabel>
      </RadioGroup.Item>
    </RadioGroup>
  );
}
// #endregion

// #region demo:disabled
function DisabledDemo() {
  return (
    <RadioGroup
      defaultValue="all"
      disabled
      aria-label="Apply changes to"
      class="text-sm text-ink-disabled"
    >
      <For each={SCOPE_OPTIONS}>
        {(option) => (
          <RadioGroup.Item value={option.value}>
            <RadioGroup.ItemControl />
            <RadioGroup.ItemLabel>{option.label}</RadioGroup.ItemLabel>
          </RadioGroup.Item>
        )}
      </For>
    </RadioGroup>
  );
}
// #endregion

export default defineDoc({
  name: 'RadioGroup',
  category: 'Inputs',
  description:
    "A Kobalte radio group with the app's control styling. Composed from slots, so the item label, description, and error message are yours to place.",
  status: 'stable',
  exports: ['RadioGroup'],
  import: "import { RadioGroup } from '@ui';",
  demos: [
    {
      id: 'basic',
      title: 'Basic',
      description:
        'Pass `value` and `onChange` for a controlled group, or `defaultValue` to let it manage itself. `RadioGroup.ItemControl` renders the hidden input as well as the dot.',
      render: BasicDemo,
    },
    {
      id: 'horizontal',
      title: 'Horizontal',
      description:
        'The root defaults to a vertical stack; override with `flex-row` and a smaller `ItemControl` for a compact inline selector, e.g. a form footer.',
      render: HorizontalDemo,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      description: '`disabled` on the root dims and locks every item.',
      render: DisabledDemo,
    },
  ],
});
