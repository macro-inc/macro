import { defineDoc } from '@app/features/ui-gallery/types';
import type { CollectionNode } from '@kobalte/core';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { createSignal } from 'solid-js';
import { Select } from './Select';

type Option = { value: string; label: string; hint?: string };

const OPTIONS: Option[] = [
  { value: 'owner', label: 'Owner', hint: 'Full access, including billing' },
  { value: 'admin', label: 'Admin', hint: 'Manage members and settings' },
  { value: 'member', label: 'Member', hint: 'Create and edit content' },
  { value: 'guest', label: 'Guest', hint: 'View shared items only' },
];

const ITEM_CLASS =
  'flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-hover';

// #region demo:basic
function BasicDemo() {
  const [value, setValue] = createSignal<Option>(OPTIONS[2]!);

  return (
    <Select<Option>
      options={OPTIONS}
      value={value()}
      onChange={(option) => option && setValue(option)}
      optionValue="value"
      optionTextValue="label"
      gutter={4}
      itemComponent={(props: { item: CollectionNode<Option> }) => (
        <Select.Item item={props.item} class={ITEM_CLASS}>
          <Select.ItemLabel>{props.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator>
            <CheckIcon class="size-3" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger class="h-8 w-44 rounded-md border border-edge-muted px-2 text-sm text-ink-muted">
        <Select.Value<Option>>
          {(state) => state.selectedOption().label}
        </Select.Value>
        <CaretDownIcon class="size-3 shrink-0 text-ink-subtle" />
      </Select.Trigger>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}
// #endregion

// #region demo:rich-items
function RichItemsDemo() {
  const [value, setValue] = createSignal<Option>(OPTIONS[1]!);

  return (
    <Select<Option>
      options={OPTIONS}
      value={value()}
      onChange={(option) => option && setValue(option)}
      optionValue="value"
      optionTextValue="label"
      gutter={4}
      itemComponent={(props: { item: CollectionNode<Option> }) => (
        <Select.Item item={props.item} class={ITEM_CLASS}>
          <span class="flex flex-col gap-0.5">
            <Select.ItemLabel>{props.item.rawValue.label}</Select.ItemLabel>
            <span class="text-xs text-ink-subtle">
              {props.item.rawValue.hint}
            </span>
          </span>
          <Select.ItemIndicator>
            <CheckIcon class="size-3" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger class="h-8 w-56 rounded-md border border-edge-muted px-2 text-sm text-ink-muted">
        <Select.Value<Option>>
          {(state) => state.selectedOption().label}
        </Select.Value>
        <CaretDownIcon class="size-3 shrink-0 text-ink-subtle" />
      </Select.Trigger>
      <Select.Content class="min-w-56">
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}
// #endregion

// #region demo:disabled
function DisabledDemo() {
  return (
    <Select<Option>
      options={OPTIONS}
      value={OPTIONS[0]}
      disabled
      optionValue="value"
      optionTextValue="label"
      itemComponent={(props: { item: CollectionNode<Option> }) => (
        <Select.Item item={props.item} class={ITEM_CLASS}>
          <Select.ItemLabel>{props.item.rawValue.label}</Select.ItemLabel>
        </Select.Item>
      )}
    >
      <Select.Trigger class="h-8 w-44 rounded-md border border-edge-muted px-2 text-sm text-ink-disabled">
        <Select.Value<Option>>
          {(state) => state.selectedOption().label}
        </Select.Value>
        <CaretDownIcon class="size-3 shrink-0" />
      </Select.Trigger>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}
// #endregion

export default defineDoc({
  name: 'Select',
  category: 'Inputs',
  description:
    'A Kobalte select, styled for the app. It is slot-based: you supply the trigger and the item renderer, while `Select.Content` handles portalling, popper sizing, menu chrome, and its own layer depth.',
  status: 'stable',
  exports: ['Select'],
  import: "import { Select } from '@ui';",
  demos: [
    {
      id: 'basic',
      title: 'Basic',
      description:
        '`optionValue` and `optionTextValue` tell the collection which fields identify and label each option. `Select.Value` receives the selected option, so the trigger renders whatever you want.',
      render: BasicDemo,
    },
    {
      id: 'rich-items',
      title: 'Rich items',
      description:
        '`itemComponent` renders arbitrary content. Keep `Select.ItemLabel` around the primary text so typeahead and the accessible name still work.',
      render: RichItemsDemo,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      description:
        'A disabled select keeps its value visible but will not open.',
      render: DisabledDemo,
    },
  ],
  props: [
    {
      name: 'options',
      type: 'Option[]',
      required: true,
      description: 'The collection to choose from.',
    },
    {
      name: 'value',
      type: 'Option | undefined',
      description: 'Controlled selection. Pair with `onChange`.',
    },
    {
      name: 'onChange',
      type: '(value: Option | null) => void',
      description: 'Fires with the new selection, or null when cleared.',
    },
    {
      name: 'optionValue',
      type: 'keyof Option',
      description: 'Field that uniquely identifies an option.',
    },
    {
      name: 'optionTextValue',
      type: 'keyof Option',
      description: 'Field used for typeahead and the accessible name.',
    },
    {
      name: 'itemComponent',
      type: '(props: { item: CollectionNode<Option> }) => JSX.Element',
      required: true,
      description: 'Renders one option inside the listbox.',
    },
    {
      name: 'placement',
      type: 'Placement',
      default: "'bottom-start'",
      description: 'Where the content opens relative to the trigger.',
    },
    {
      name: 'gutter',
      type: 'number',
      description: 'Pixel gap between the trigger and the content.',
    },
    {
      name: 'disabled',
      type: 'boolean',
      default: 'false',
      description: 'Prevents the select from opening.',
    },
  ],
  guidelines: {
    do: [
      'Let `Select.Content` own the menu chrome; pass only sizing classes to it.',
      'Include `Select.ItemIndicator` so the current selection is visible in the list.',
      'Use `portalScope="local"` when the select lives inside a dialog or other portal scope.',
    ],
    dont: [
      'Do not wrap `Select.Content` in a Portal — it already portals itself.',
      'Do not use Select for more than roughly a dozen options; use a command menu with search.',
    ],
  },
});
