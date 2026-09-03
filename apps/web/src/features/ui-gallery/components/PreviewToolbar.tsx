import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { ThemeChips } from '@theme/components/ThemeChips';
import type { ThemeV3 } from '@theme/types/themeTypes';
import { SegmentedControl, Select } from '@ui';
import type { CollectionNode } from '@kobalte/core';
import { Show } from 'solid-js';
import type { PreviewSettings } from './DemoPreview';

const DEPTHS = [0, 1, 2, 3, 4] as const;

type ThemeOption = { id: string; label: string; theme: ThemeV3 | null };

/**
 * Controls that apply to every preview on the page: which theme the demos
 * render in, and which surface depth they sit on. Depth is a first-class
 * control because it is the axis this design system varies on — a component
 * that only looks right at depth 0 is the bug this gallery exists to catch.
 */
export function PreviewToolbar(props: {
  themes: readonly ThemeV3[];
  settings: PreviewSettings;
  onThemeChange: (theme: ThemeV3 | null) => void;
  onDepthChange: (depth: 0 | 1 | 2 | 3 | 4) => void;
}) {
  const options = (): ThemeOption[] => [
    { id: '', label: 'App theme', theme: null },
    ...props.themes.map((theme) => ({
      id: theme.id,
      label: theme.name,
      theme,
    })),
  ];

  const selected = () =>
    options().find(
      (option) => option.id === (props.settings.theme?.id ?? '')
    ) ?? options()[0]!;

  return (
    <div class="flex flex-wrap items-center gap-4">
      <div class="flex items-center gap-2">
        <span class="text-xs text-ink-subtle">Theme</span>
        <Select<ThemeOption>
          options={options()}
          value={selected()}
          onChange={(option) => option && props.onThemeChange(option.theme)}
          optionValue="id"
          optionTextValue="label"
          gutter={4}
          itemComponent={(itemProps: { item: CollectionNode<ThemeOption> }) => (
            <Select.Item
              item={itemProps.item}
              class="flex items-center justify-between gap-3 px-2 py-1.5 text-sm rounded-xs outline-none data-highlighted:bg-hover"
            >
              <span class="flex items-center gap-2">
                <Show when={itemProps.item.rawValue.theme}>
                  {(theme) => <ThemeChips theme={theme()} size="sm" />}
                </Show>
                <Select.ItemLabel>
                  {itemProps.item.rawValue.label}
                </Select.ItemLabel>
              </span>
              <Select.ItemIndicator>
                <CheckIcon class="size-3" />
              </Select.ItemIndicator>
            </Select.Item>
          )}
        >
          <Select.Trigger class="h-7 gap-1.5 px-2 text-xs rounded-md border border-edge-muted text-ink-muted hover:text-ink hover:bg-hover data-expanded:bg-active">
            <Show when={selected().theme}>
              {(theme) => <ThemeChips theme={theme()} size="sm" />}
            </Show>
            <Select.Value<ThemeOption>>
              {(state) => state.selectedOption().label}
            </Select.Value>
            <CaretDownIcon class="size-3 shrink-0 text-ink-subtle" />
          </Select.Trigger>
          <Select.Content class="max-h-80">
            <Select.Listbox />
          </Select.Content>
        </Select>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-xs text-ink-subtle">Depth</span>
        <SegmentedControl
          size="sm"
          aria-label="Preview surface depth"
          value={props.settings.depth}
          onChange={props.onDepthChange}
          options={DEPTHS.map((depth) => ({
            value: depth,
            label: String(depth),
          }))}
        />
      </div>
    </div>
  );
}
