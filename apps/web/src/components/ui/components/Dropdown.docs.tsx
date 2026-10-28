import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal, For } from 'solid-js';
import { Dropdown } from './Dropdown';

// #region demo:multiselect
function MultiselectDemo() {
  const [selected, setSelected] = createSignal(['Docs']);
  return (
    <div class="flex flex-col items-start gap-3">
      <Dropdown>
        <Dropdown.Trigger>Filter types</Dropdown.Trigger>
        <Dropdown.Content class="min-w-56">
          <Dropdown.Group>
            <For each={['Docs', 'Tasks', 'Mail']}>
              {(label) => (
                <Dropdown.MultiSelectItem
                  label={label}
                  checked={selected().includes(label)}
                  onChange={(checked) =>
                    setSelected((values) =>
                      checked
                        ? values.includes(label)
                          ? values
                          : [...values, label]
                        : values.filter((value) => value !== label)
                    )
                  }
                  onOnly={() => setSelected([label])}
                >
                  <span class="flex-1 truncate">{label}</span>
                </Dropdown.MultiSelectItem>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
      <p class="text-xs text-ink-muted">
        Selected: {selected().join(', ') || 'None'}
      </p>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Dropdown',
  category: 'Overlays',
  description:
    'Menus with shared keyboard navigation. Multiselect rows distinguish toggling, adding, and selecting only one option.',
  status: 'stable',
  import: "import { Dropdown } from '@ui';",
  exports: ['Dropdown'],
  propTypes: ['DropdownMultiSelectItemProps'],
  demos: [
    {
      id: 'multiselect',
      title: 'Multiselect filters',
      description:
        'Checkbox or Space toggles and stays open. Row or Enter adds and closes. Shift-click, Shift+Enter, or Only selects just one and stays open. Only is always visible on touch.',
      render: MultiselectDemo,
    },
  ],
});
