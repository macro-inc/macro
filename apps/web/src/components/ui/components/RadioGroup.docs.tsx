import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal, For } from 'solid-js';
import { RadioGroup } from './RadioGroup';

const SCOPE_OPTIONS = [
  { value: 'this_event', label: 'This event' },
  { value: 'this_and_following', label: 'This and following events' },
  { value: 'all', label: 'All events' },
];

const ACCESS_OPTIONS = [
  {
    value: 'team',
    label: 'Team',
    description: 'Anyone on the team can find and join',
  },
  {
    value: 'invite',
    label: 'Invite only',
    description: 'Only invited people can view or join',
  },
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
      size="sm"
      aria-label="Apply changes to"
      class="flex-row items-center gap-3 text-xs text-ink-muted"
    >
      <RadioGroup.Item value="this_event" class="gap-1.5">
        <RadioGroup.ItemControl />
        <RadioGroup.ItemLabel>This event</RadioGroup.ItemLabel>
      </RadioGroup.Item>
      <RadioGroup.Item value="all" class="gap-1.5">
        <RadioGroup.ItemControl />
        <RadioGroup.ItemLabel>All events</RadioGroup.ItemLabel>
      </RadioGroup.Item>
    </RadioGroup>
  );
}
// #endregion

// #region demo:cards
function CardsDemo() {
  const [value, setValue] = createSignal('team');

  return (
    <RadioGroup
      variant="cards"
      value={value()}
      onChange={setValue}
      aria-label="Who can join"
      class="max-w-md grid-cols-1 sm:grid-cols-2"
    >
      <For each={ACCESS_OPTIONS}>
        {(option) => (
          <RadioGroup.Item value={option.value}>
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <RadioGroup.ItemLabel class="text-sm font-medium text-ink">
                {option.label}
              </RadioGroup.ItemLabel>
              <RadioGroup.ItemDescription class="text-xs text-ink-muted">
                {option.description}
              </RadioGroup.ItemDescription>
            </div>
            <RadioGroup.ItemControl class="mt-0.5" />
          </RadioGroup.Item>
        )}
      </For>
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

// #region demo:states
function StatesDemo() {
  return (
    <div class="grid gap-6">
      <For each={['sm', 'md', 'lg'] as const}>
        {(size) => (
          <RadioGroup
            defaultValue="on"
            size={size}
            aria-label={`${size} radio size`}
          >
            <RadioGroup.Item value="on">
              <RadioGroup.ItemControl />
              <RadioGroup.ItemLabel>{size}</RadioGroup.ItemLabel>
            </RadioGroup.Item>
          </RadioGroup>
        )}
      </For>
      <RadioGroup validationState="invalid" aria-label="Required selection">
        <RadioGroup.Item value="required">
          <RadioGroup.ItemControl />
          <RadioGroup.ItemLabel>Choose an option</RadioGroup.ItemLabel>
        </RadioGroup.Item>
        <RadioGroup.ErrorMessage class="text-xs text-failure">
          Select one option to continue.
        </RadioGroup.ErrorMessage>
      </RadioGroup>
    </div>
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
        'The root defaults to a vertical stack. Use size="sm" and flex-row for a compact inline selector while keeping native arrow-key behavior.',
      render: HorizontalDemo,
    },
    {
      id: 'cards',
      title: 'Cards',
      description:
        '`variant="cards"` frames each choice as a card with a title and a description, for a decision that needs explaining. The whole card selects; lay the cards out with grid classes on the root.',
      render: CardsDemo,
    },
    {
      id: 'states',
      title: 'Sizes and validation',
      description:
        'Unchecked circles stay transparent. Checked circles fill with the accent and show a contrasting dot. Size controls both the circle and its dot.',
      render: StatesDemo,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      description: '`disabled` on the root dims and locks every item.',
      render: DisabledDemo,
    },
  ],
});
