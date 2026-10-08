import { defineDoc } from '@app/features/ui-gallery/types';
import { Tabs } from '@kobalte/core/tabs';
import { createSignal, For } from 'solid-js';
import { Dropdown } from './Dropdown';
import { TabSelector } from './TabSelector';
import { Tooltip } from './Tooltip';

// #region demo:overflow
function OverflowDemo() {
  const [selected, setSelected] = createSignal('Authors');
  return (
    <TabSelector class="w-72 max-w-full">
      <Tabs
        value={selected()}
        onChange={setSelected}
        activationMode="manual"
        class="min-w-0"
      >
        <TabSelector.List aria-label="Example tables">
          <For each={['Authors', 'Books', 'Reading log', 'Recommendations']}>
            {(name) => (
              <Tooltip label={name}>
                <TabSelector.Tab value={name}>
                  <span class="truncate">{name}</span>
                </TabSelector.Tab>
              </Tooltip>
            )}
          </For>
        </TabSelector.List>
      </Tabs>
      <TabSelector.AddMenu label="Add table or form">
        <Dropdown.Item>New table</Dropdown.Item>
        <Dropdown.Item>New form</Dropdown.Item>
      </TabSelector.AddMenu>
    </TabSelector>
  );
}
// #endregion

export default defineDoc({
  name: 'TabSelector',
  category: 'Navigation',
  description:
    'Inset tabs with horizontal scrolling and a fixed add menu. Compose the track with Kobalte Tabs; keep AddMenu outside the tab collection.',
  exports: ['TabSelector'],
  import: "import { TabSelector } from '@ui';",
  demos: [
    {
      id: 'overflow',
      title: 'Overflow and add menu',
      description:
        'Use a trackpad, mouse wheel, or the arrow buttons to scroll. Keyboard focus reveals offscreen tabs, and the add menu stays at the right edge.',
      render: OverflowDemo,
    },
  ],
});
