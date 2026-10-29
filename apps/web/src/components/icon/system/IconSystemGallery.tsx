import { macroDarkTheme } from '@app/features/theme/themes/macro-dark';
import { macroLightTheme } from '@app/features/theme/themes/macro-light';
import { Button, Input, Tabs } from '@ui';
import {
  type Component,
  type ComponentProps,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ShareIcon from '../share.svg';

type IconComponent = Component<ComponentProps<'svg'>>;
type IconWeight = 'regular' | 'fill' | 'bold';
type IconEntry = { name: string; component: IconComponent };

// This module is reached only through the lazy icon-gallery debug route.
// Keep the specimen catalog out of production icon imports and app startup.
const modules = import.meta.glob<{ default: IconComponent }>(
  ['./regular/*.svg', './fill/*.svg', './bold/*.svg'],
  { eager: true, query: '?component-solid' }
);

const icons: Record<IconWeight, IconEntry[]> = {
  regular: [],
  fill: [],
  bold: [],
};

for (const [path, module] of Object.entries(modules)) {
  const [, weight, file] = path.split('/');
  if (
    !file ||
    (weight !== 'regular' && weight !== 'fill' && weight !== 'bold')
  ) {
    continue;
  }
  icons[weight].push({
    name: file.replace(/(-fill|-bold)?\.svg$/, ''),
    component: module.default,
  });
}

icons.regular.push({ name: 'share', component: ShareIcon });

for (const entries of Object.values(icons)) {
  entries.sort((a, b) => a.name.localeCompare(b.name));
}

const SIZES = [14, 16, 20, 24];
const WEIGHTS: { value: IconWeight; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'fill', label: 'Filled' },
  { value: 'bold', label: 'Bold' },
];
const PREVIEW_THEMES = [macroLightTheme, macroDarkTheme].map((theme) => ({
  name: theme.name,
  light: theme.mode === 'light',
  style: {
    ...Object.fromEntries(
      Object.entries(theme.colorTokens).map(([token, value]) => [
        `--color-${token}`,
        value,
      ])
    ),
    '--layer-surface': 'var(--color-panel)',
    '--layer-inset': 'var(--color-surface-0)',
  } satisfies JSX.CSSProperties,
}));

const NAVIGATION = [
  { name: 'house', label: 'Home' },
  { name: 'envelope', label: 'Mail' },
  { name: 'calendar-blank', label: 'Calendar' },
  { name: 'chats-circle', label: 'Chat' },
  { name: 'folder-simple', label: 'Drive' },
  { name: 'list-checks', label: 'Tasks' },
  { name: 'sparkle', label: 'Agents' },
  { name: 'buildings', label: 'Customers' },
  { name: 'phone-call', label: 'Calls' },
  { name: 'git-pull-request', label: 'Pull requests' },
];
const TOOLBAR = [
  { name: 'sidebar-simple', label: 'Sidebar' },
  { name: 'magnifying-glass', label: 'Search' },
  { name: 'paperclip', label: 'Attach' },
  { name: 'share', label: 'Share' },
  { name: 'users', label: 'Members' },
  { name: 'gear', label: 'Settings' },
];

function Glyph(props: { name: string; size: number; weight?: IconWeight }) {
  const icon = () =>
    icons[props.weight ?? 'regular'].find((entry) => entry.name === props.name);
  return (
    <span
      class="inline-flex shrink-0 items-center justify-center"
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
      aria-hidden="true"
      data-icon-motion-target
    >
      <Show when={icon()}>
        {(entry) => <Dynamic component={entry().component} />}
      </Show>
    </span>
  );
}

function InterfaceSpecimen(props: {
  theme: (typeof PREVIEW_THEMES)[number];
  activeName: string;
  onSelect: (name: string) => void;
}) {
  return (
    <section
      class="min-w-0 overflow-hidden rounded-xl border border-edge-muted bg-panel text-ink"
      style={props.theme.style}
      data-theme-light={props.theme.light}
      aria-label={`${props.theme.name} interface specimen`}
    >
      <div class="flex items-center justify-between px-5 pt-4 text-xs text-ink-muted">
        <span>{props.theme.name}</span>
        <span>Navigation · 20 px</span>
      </div>
      <div class="flex flex-wrap items-center gap-1 px-4 py-4">
        <For each={NAVIGATION}>
          {(item) => (
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={item.label}
              aria-pressed={props.activeName === item.name}
              title={item.label}
              onClick={() => props.onSelect(item.name)}
            >
              <Glyph
                name={item.name}
                size={20}
                weight={props.activeName === item.name ? 'fill' : 'regular'}
              />
            </Button>
          )}
        </For>
      </div>
      <div class="flex items-center justify-between gap-3 border-t border-edge-muted px-5 py-3">
        <span class="text-xs text-ink-muted">Toolbar · 16 px</span>
        <div class="flex items-center gap-1 text-ink-muted">
          <For each={TOOLBAR}>
            {(item) => (
              <Button
                variant="ghost"
                size="icon-md"
                aria-label={item.label}
                title={item.label}
              >
                <Glyph name={item.name} size={16} />
              </Button>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}

export default function IconSystemGallery() {
  const [query, setQuery] = createSignal('');
  const [weight, setWeight] = createSignal<IconWeight>('regular');
  const [activeName, setActiveName] = createSignal('house');
  const filteredIcons = createMemo(() => {
    const normalizedQuery = query().trim().toLowerCase().replaceAll(' ', '-');
    return icons[weight()].filter((icon) =>
      icon.name.includes(normalizedQuery)
    );
  });

  return (
    <div class="size-full overflow-auto bg-panel text-ink">
      <main class="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <header class="mb-7">
          <div class="mb-2 flex items-center gap-3">
            <h1 class="text-xl font-semibold tracking-tight">Macro icons</h1>
            <span class="rounded-md bg-hover px-2 py-1 text-[11px] text-ink-muted">
              Original set
            </span>
          </div>
          <p class="max-w-xl text-sm text-ink-muted">
            Icon specimen at actual interface sizes. Compare weight, spacing,
            and selected states on both Macro themes. Press the navigation and
            toolbar icons to preview motion; search and settings also respond to
            a brief hover. Reduced motion keeps the icons still.
          </p>
        </header>

        <div class="mb-8 grid gap-4 xl:grid-cols-2">
          <For each={PREVIEW_THEMES}>
            {(theme) => (
              <InterfaceSpecimen
                theme={theme}
                activeName={activeName()}
                onSelect={setActiveName}
              />
            )}
          </For>
        </div>

        <div class="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div class="flex flex-wrap items-center gap-3">
            <Tabs
              aria-label="Icon weight"
              options={WEIGHTS.map((option) => ({
                ...option,
                count: icons[option.value].length,
              }))}
              value={weight()}
              onChange={setWeight}
            />
            <span class="text-xs text-ink-muted" aria-live="polite">
              {filteredIcons().length} of {icons[weight()].length} icons
            </span>
          </div>
          <Input
            type="search"
            aria-label="Filter icons by name"
            placeholder="Filter icons…"
            class="w-full sm:w-60"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>

        <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
          <span>Light and dark · same geometry</span>
          <span>14 / 16 / 20 / 24 px</span>
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <For each={filteredIcons()}>
            {(icon) => (
              <article class="min-w-0 overflow-hidden rounded-lg border border-edge-muted">
                <For each={PREVIEW_THEMES}>
                  {(theme) => (
                    <div
                      class="grid grid-cols-4 items-center bg-panel px-3 py-3 text-ink-muted"
                      style={theme.style}
                      data-theme-light={theme.light}
                      aria-label={`${icon.name}, ${theme.name}`}
                    >
                      <For each={SIZES}>
                        {(size) => (
                          <span
                            class="flex h-7 items-center justify-center"
                            title={`${size} px`}
                          >
                            <span
                              class="inline-flex shrink-0"
                              style={{
                                width: `${size}px`,
                                height: `${size}px`,
                              }}
                            >
                              <Dynamic component={icon.component} />
                            </span>
                          </span>
                        )}
                      </For>
                    </div>
                  )}
                </For>
                <div class="border-t border-edge-muted px-3 py-2.5 text-xs text-ink-muted">
                  {icon.name}
                </div>
              </article>
            )}
          </For>
        </div>
        <Show when={filteredIcons().length === 0}>
          <p class="py-16 text-center text-sm text-ink-muted">
            No icons match “{query()}”.
          </p>
        </Show>
      </main>
    </div>
  );
}
