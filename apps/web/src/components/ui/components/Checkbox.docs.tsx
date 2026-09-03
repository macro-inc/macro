import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal, For } from 'solid-js';
import { Checkbox, InlineCheckbox, SingleSelectCheck } from './Checkbox';

// #region demo:basic
function BasicDemo() {
  const [checked, setChecked] = createSignal(true);

  return (
    <div class="flex flex-col gap-3">
      <Checkbox checked={checked()} onChange={setChecked}>
        <Checkbox.Control />
        <Checkbox.Label class="text-sm text-ink">
          Notify me about replies
        </Checkbox.Label>
      </Checkbox>
      <Checkbox defaultChecked={false}>
        <Checkbox.Control />
        <Checkbox.Label class="text-sm text-ink">Unchecked</Checkbox.Label>
      </Checkbox>
    </div>
  );
}
// #endregion

// #region demo:states
function StatesDemo() {
  return (
    <div class="flex flex-col gap-3">
      <Checkbox indeterminate>
        <Checkbox.Control />
        <Checkbox.Label class="text-sm text-ink">Indeterminate</Checkbox.Label>
      </Checkbox>
      <Checkbox disabled defaultChecked>
        <Checkbox.Control />
        <Checkbox.Label class="text-sm text-ink-disabled">
          Disabled, checked
        </Checkbox.Label>
      </Checkbox>
      <Checkbox disabled>
        <Checkbox.Control />
        <Checkbox.Label class="text-sm text-ink-disabled">
          Disabled
        </Checkbox.Label>
      </Checkbox>
    </div>
  );
}
// #endregion

// #region demo:list-affordances
function ListAffordancesDemo() {
  const [selected, setSelected] = createSignal('Inbox');
  const rows = ['Inbox', 'Drafts', 'Sent'];

  return (
    <div class="flex w-full max-w-sm flex-col gap-4">
      <div class="flex flex-col">
        <span class="mb-1 font-mono text-xs text-ink-subtle">
          SingleSelectCheck
        </span>
        <For each={rows}>
          {(row) => (
            <button
              type="button"
              class="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm text-ink hover:bg-hover"
              onClick={() => setSelected(row)}
            >
              {row}
              <SingleSelectCheck active={selected() === row} />
            </button>
          )}
        </For>
      </div>

      <div class="flex flex-col">
        <span class="mb-1 font-mono text-xs text-ink-subtle">
          InlineCheckbox
        </span>
        <For each={rows}>
          {(row) => (
            <div class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-ink">
              <InlineCheckbox checked={row !== 'Sent'} />
              {row}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Checkbox',
  category: 'Inputs',
  description:
    'A Kobalte checkbox with the app’s control styling. Composed from slots, so the label, description, and error message are yours to place.',
  status: 'stable',
  exports: ['Checkbox', 'InlineCheckbox', 'SingleSelectCheck'],
  import: "import { Checkbox, InlineCheckbox, SingleSelectCheck } from '@ui';",
  demos: [
    {
      id: 'basic',
      title: 'Basic',
      description:
        'Pass `checked` and `onChange` for a controlled checkbox, or `defaultChecked` to let it manage itself. `Checkbox.Control` renders the hidden input as well as the box.',
      render: BasicDemo,
    },
    {
      id: 'states',
      title: 'States',
      description:
        '`indeterminate` shows a dash instead of a check — use it for a parent whose children are partially selected.',
      render: StatesDemo,
    },
    {
      id: 'list-affordances',
      title: 'List affordances',
      description:
        'Two visual-only helpers for rows that are themselves the hit target: `SingleSelectCheck` for pick-one menus, `InlineCheckbox` for multi-select lists. Neither handles input — the row does.',
      render: ListAffordancesDemo,
    },
  ],
  props: [
    {
      name: 'checked',
      type: 'boolean',
      description: 'Controlled checked state. Pair with `onChange`.',
    },
    {
      name: 'defaultChecked',
      type: 'boolean',
      default: 'false',
      description: 'Initial state for an uncontrolled checkbox.',
    },
    {
      name: 'indeterminate',
      type: 'boolean',
      default: 'false',
      description: 'Renders the partial-selection dash.',
    },
    {
      name: 'onChange',
      type: '(checked: boolean) => void',
      description: 'Fires on user interaction.',
    },
    {
      name: 'disabled',
      type: 'boolean',
      default: 'false',
      description: 'Blocks interaction and dims the control.',
    },
    {
      name: 'validationState',
      type: "'valid' | 'invalid'",
      description:
        'Drives the failure-colored border and `Checkbox.ErrorMessage`.',
    },
  ],
  guidelines: {
    do: [
      'Always render a `Checkbox.Label`, even when the visible text sits elsewhere.',
      'Use `indeterminate` on a select-all that only covers part of its group.',
      'Use `InlineCheckbox` when the whole row is already clickable.',
    ],
    dont: [
      'Do not use a checkbox for an immediate action — that is a ToggleSwitch or a Button.',
      'Do not add `Checkbox.Input` yourself; `Checkbox.Control` already renders one.',
    ],
  },
});
