import { defineDoc } from '@app/features/ui-gallery/types';
import { t } from '@app/lib/i18n';
import { ContextMenuContent, CopyMenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
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

// #region demo:unavailable
function UnavailableDemo() {
  return (
    <Dropdown>
      <Dropdown.Trigger>Add</Dropdown.Trigger>
      <Dropdown.Content class="min-w-48">
        <Dropdown.Group>
          <Dropdown.Item disabledReason="This model doesn't support images">
            Add photos
          </Dropdown.Item>
          <Dropdown.Item>Add files</Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
// #endregion

// #region demo:copy
function CopyDemo() {
  return (
    <Dropdown>
      <Dropdown.Trigger>Copy</Dropdown.Trigger>
      <Dropdown.Content class="min-w-48">
        <Dropdown.CopyItem
          onCopy={() => navigator.clipboard.writeText(location.href)}
        >
          Copy link
        </Dropdown.CopyItem>
      </Dropdown.Content>
    </Dropdown>
  );
}
// #endregion

// #region demo:context-copy
function ContextCopyDemo() {
  return (
    <ContextMenu>
      <ContextMenu.Trigger class="rounded-lg border border-edge p-3 text-sm">
        Right-click to copy
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent>
          <CopyMenuItem
            text={t('entityActions.copyLink')}
            onCopy={() => navigator.clipboard.writeText(location.href)}
          />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
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
  propTypes: ['DropdownCopyItemProps', 'DropdownMultiSelectItemProps'],
  demos: [
    {
      id: 'copy',
      title: 'Copy without dismissing',
      description:
        'Return the clipboard promise from onCopy. The label stays unchanged and a green check follows successful completion. False and rejection suppress feedback.',
      render: CopyDemo,
    },
    {
      id: 'context-copy',
      title: 'Context-menu copy',
      description:
        'CopyMenuItem uses the same feedback and stays open after copying.',
      render: ContextCopyDemo,
    },
    {
      id: 'multiselect',
      title: 'Multiselect filters',
      description:
        'Clicking a row or its checkbox, or Space, toggles and stays open. Enter adds and closes. Shift-click, Shift+Enter, or Only selects just one and stays open. Only is always visible on touch.',
      render: MultiselectDemo,
    },
    {
      id: 'unavailable',
      title: 'Unavailable items',
      description:
        'disabledReason grays an item out and explains why in a tooltip beside it on hover or keyboard focus, or as a second line on touch. Unlike disabled, arrow keys still reach it; selecting it does nothing.',
      render: UnavailableDemo,
    },
  ],
});
