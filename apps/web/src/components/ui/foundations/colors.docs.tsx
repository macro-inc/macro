import { defineDoc } from '@app/features/ui-gallery/types';
import { For } from 'solid-js';

/** One labelled swatch. Local to this page so the docs stay self-contained. */
function Swatch(props: { token: string; note?: string }) {
  return (
    <div class="flex flex-col gap-1.5">
      <div
        class="h-12 w-full rounded-md border border-edge-muted"
        style={{ 'background-color': `var(--color-${props.token})` }}
      />
      <span class="font-mono text-xs text-ink">{props.token}</span>
      <span class="text-xs text-ink-subtle">{props.note ?? ''}</span>
    </div>
  );
}

function SwatchGrid(props: { tokens: { token: string; note?: string }[] }) {
  return (
    <div class="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <For each={props.tokens}>
        {(entry) => <Swatch token={entry.token} note={entry.note} />}
      </For>
    </div>
  );
}

// #region demo:surfaces
function SurfacesDemo() {
  return (
    <SwatchGrid
      tokens={[
        { token: 'surface-0', note: 'Furthest back' },
        { token: 'surface-1', note: 'Panels' },
        { token: 'surface-2', note: 'Menus, dialogs' },
        { token: 'surface-3', note: 'Raised chrome' },
        { token: 'surface-4', note: 'Closest to viewer' },
      ]}
    />
  );
}
// #endregion

// #region demo:ink
function InkDemo() {
  return (
    <SwatchGrid
      tokens={[
        { token: 'ink', note: 'Primary text' },
        { token: 'ink-muted', note: 'Secondary text' },
        { token: 'ink-subtle', note: 'Labels, captions' },
        { token: 'ink-disabled', note: 'Disabled text' },
        { token: 'ink-placeholder', note: 'Empty inputs' },
      ]}
    />
  );
}
// #endregion

// #region demo:semantic
function SemanticDemo() {
  return (
    <SwatchGrid
      tokens={[
        { token: 'accent', note: 'Brand / selection' },
        { token: 'success', note: 'Confirmed state' },
        { token: 'warning', note: 'Needs attention' },
        { token: 'failure', note: 'Errors, destructive' },
        { token: 'edge', note: 'Strong borders' },
        { token: 'edge-muted', note: 'Default borders' },
        { token: 'hover', note: 'Hover scrim' },
        { token: 'active', note: 'Pressed scrim' },
        { token: 'selected', note: 'Selected rows' },
      ]}
    />
  );
}
// #endregion

// #region demo:palette
function PaletteDemo() {
  const palette = [
    'red',
    'orange',
    'amber',
    'yellow',
    'lime',
    'green',
    'teal',
    'cyan',
    'blue',
    'violet',
    'purple',
    'pink',
  ];
  return <SwatchGrid tokens={palette.map((token) => ({ token }))} />;
}
// #endregion

export default defineDoc({
  name: 'Colors',
  category: 'Foundations',
  description:
    'Every color in the app comes from a semantic token, never a raw Tailwind color. Themes redefine the tokens; components never change.',
  demos: [
    {
      id: 'surfaces',
      title: 'Surfaces',
      description:
        'The background ramp. Components read these through the layer system rather than naming a step directly — see Surfaces & Depth.',
      render: SurfacesDemo,
      fill: true,
    },
    {
      id: 'ink',
      title: 'Ink',
      description:
        'Text colors, from primary down to placeholder. `ink-extra-muted` is a deprecated alias for `ink-subtle`; use `ink-subtle` in new code.',
      render: InkDemo,
      fill: true,
    },
    {
      id: 'semantic',
      title: 'Semantic',
      description:
        'Meaning-carrying colors. Reach for these before the raw palette so intent survives a theme change.',
      render: SemanticDemo,
      fill: true,
    },
    {
      id: 'palette',
      title: 'Palette',
      description:
        'Named hues for content that needs a color of its own — labels, calendars, avatars. Not for conveying state.',
      render: PaletteDemo,
      fill: true,
    },
  ],
  guidelines: {
    do: [
      'Use semantic tokens: `text-ink-muted`, `bg-surface`, `border-edge-muted`.',
      'Use `failure` / `success` / `warning` for state, so every theme stays legible.',
      'Pick from the named palette when content needs identity rather than meaning.',
    ],
    dont: [
      'Do not use raw Tailwind colors (`text-gray-500`, `bg-blue-600`) — they ignore the theme.',
      'Do not hardcode hex or oklch values in components.',
      'Do not use `ink-extra-muted` in new code; it is a temporary compatibility alias.',
    ],
  },
});
