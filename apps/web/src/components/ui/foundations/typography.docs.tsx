import { defineDoc } from '@app/features/ui-gallery/types';
import { For } from 'solid-js';

const SAMPLE = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

// #region demo:sizes
function SizesDemo() {
  const sizes = [
    { class: 'text-xs', note: 'Labels, badges, captions' },
    { class: 'text-sm', note: 'Default UI text' },
    { class: 'text-base', note: 'Body copy, reading surfaces' },
    { class: 'text-lg', note: 'Section headings' },
    { class: 'text-xl', note: 'Page headings' },
    { class: 'text-2xl', note: 'Page titles' },
  ];

  return (
    <div class="flex w-full flex-col gap-4">
      <For each={sizes}>
        {(size) => (
          <div class="flex flex-col gap-1">
            <div class="flex items-baseline gap-2">
              <span class="font-mono text-xs text-ink-subtle">
                {size.class}
              </span>
              <span class="text-xs text-ink-subtle">{size.note}</span>
            </div>
            <p class={`${size.class} text-ink`}>{SAMPLE}</p>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:hierarchy
function HierarchyDemo() {
  const inks = [
    { class: 'text-ink', note: 'Primary content' },
    { class: 'text-ink-muted', note: 'Supporting content' },
    { class: 'text-ink-subtle', note: 'Labels and metadata' },
    { class: 'text-ink-disabled', note: 'Unavailable controls' },
    { class: 'text-ink-placeholder', note: 'Empty input hints' },
  ];

  return (
    <div class="flex w-full flex-col gap-4">
      <For each={inks}>
        {(ink) => (
          <div class="flex flex-col gap-1">
            <div class="flex items-baseline gap-2">
              <span class="font-mono text-xs text-ink-subtle">{ink.class}</span>
              <span class="text-xs text-ink-subtle">{ink.note}</span>
            </div>
            <p class={`text-base ${ink.class}`}>{SAMPLE}</p>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:matrix
function MatrixDemo() {
  const sizes = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl'];
  const inks = [
    'text-ink',
    'text-ink-muted',
    'text-ink-subtle',
    'text-ink-disabled',
    'text-ink-placeholder',
  ];

  return (
    <table class="w-full border-collapse">
      <thead>
        <tr>
          <th class="border-b border-edge-muted p-2 text-left text-xs text-ink-subtle">
            Size / Ink
          </th>
          <For each={inks}>
            {(ink) => (
              <th class="border-b border-edge-muted p-2 text-left font-mono text-xs text-ink-subtle">
                {ink.replace('text-ink', '') || 'ink'}
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>
        <For each={sizes}>
          {(size) => (
            <tr>
              <td class="border-b border-edge-muted p-2 font-mono text-xs text-ink-subtle">
                {size}
              </td>
              <For each={inks}>
                {(ink) => (
                  <td class={`border-b border-edge-muted p-2 ${size} ${ink}`}>
                    Aa
                  </td>
                )}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}
// #endregion

export default defineDoc({
  name: 'Typography',
  category: 'Foundations',
  description:
    'Size sets scale, ink sets hierarchy. Between them they cover nearly every text decision in the app — reach for a different weight only when both are already right.',
  demos: [
    {
      id: 'sizes',
      title: 'Sizes',
      description:
        '`text-sm` is the default for UI chrome; `text-base` is for reading surfaces such as documents and messages.',
      render: SizesDemo,
      fill: true,
    },
    {
      id: 'hierarchy',
      title: 'Hierarchy',
      description:
        'Establish rank with ink before reaching for size or weight. Two ink steps read as a clear hierarchy at the same size.',
      render: HierarchyDemo,
      fill: true,
    },
    {
      id: 'matrix',
      title: 'Size × ink',
      description:
        'Every combination at a glance. Check the lower-contrast inks stay legible when you change a theme with the toolbar above.',
      render: MatrixDemo,
      fill: true,
    },
  ],
  guidelines: {
    do: [
      'Default to `text-sm` for interface text and `text-base` for content.',
      'Signal hierarchy with ink first, then size, then weight.',
      'Keep metadata and labels at `text-xs text-ink-subtle`.',
    ],
    dont: [
      'Do not introduce sizes outside this scale.',
      'Do not stack low-contrast ink on a small size for anything a user must read.',
    ],
  },
});
