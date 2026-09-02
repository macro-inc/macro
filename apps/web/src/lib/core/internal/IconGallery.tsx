import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { type Component, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

// Theme color swatches - uses CSS variables from the theme
const THEME_COLORS = [
  // Rows 1–3: authored palette colors
  { name: 'Red', value: 'red', css: 'var(--color-red)' },
  { name: 'Orange', value: 'orange', css: 'var(--color-orange)' },
  { name: 'Amber', value: 'amber', css: 'var(--color-amber)' },
  { name: 'Yellow', value: 'yellow', css: 'var(--color-yellow)' },
  { name: 'Lime', value: 'lime', css: 'var(--color-lime)' },
  { name: 'Green', value: 'green', css: 'var(--color-green)' },
  { name: 'Teal', value: 'teal', css: 'var(--color-teal)' },
  { name: 'Cyan', value: 'cyan', css: 'var(--color-cyan)' },
  { name: 'Blue', value: 'blue', css: 'var(--color-blue)' },
  { name: 'Violet', value: 'violet', css: 'var(--color-violet)' },
  { name: 'Purple', value: 'purple', css: 'var(--color-purple)' },
  { name: 'Pink', value: 'pink', css: 'var(--color-pink)' },
  // Row 3 continued: semantic colors
  { name: 'Failure', value: 'failure', css: 'var(--color-failure)' },
  { name: 'Success', value: 'success', css: 'var(--color-success)' },
  { name: 'Alert', value: 'alert', css: 'var(--color-alert)' },
  // Row 4: Contrast/ink colors (grays)
  { name: 'Ink', value: 'ink', css: 'var(--color-ink)' },
  { name: 'Ink Muted', value: 'ink-muted', css: 'var(--color-ink-muted)' },
  {
    name: 'Ink Extra Muted',
    value: 'ink-extra-muted',
    css: 'var(--color-ink-extra-muted)',
  },
  {
    name: 'Ink Disabled',
    value: 'ink-disabled',
    css: 'var(--color-ink-disabled)',
  },
  {
    name: 'Ink Placeholder',
    value: 'ink-placeholder',
    css: 'var(--color-ink-placeholder)',
  },
] as const;

type ColorOption =
  | (typeof THEME_COLORS)[number]
  | { name: 'Custom'; value: 'custom'; css: string };

// Note: import.meta.glob does not support TS path aliases (e.g. @design/*, @icon/*).
// Patterns must start with '/' or './', so we use relative paths from this file.

// Dynamically import all static SVG icons
const staticIconModules = import.meta.glob(
  '../../../components/icon/wide-*.svg',
  {
    eager: true,
    query: '?component-solid',
  }
) as Record<string, { default: Component }>;

// Dynamically import all animated icon modules
const animatedIconModules = import.meta.glob(
  '../../../components/icon/wide-*.tsx',
  {
    eager: true,
  }
) as Record<string, Record<string, Component<{ triggerAnimation?: boolean }>>>;

// Extract icon name from file path
function getIconName(path: string): string {
  const filename = path.split('/').pop() || '';
  return filename.replace(/\.(svg|tsx)$/, '');
}

// Convert kebab-case to PascalCase for matching animated icon exports
function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

// Normalize name to kebab-case for consistent matching
function toKebabCase(str: string): string {
  // Handle camelCase: insert hyphen before uppercase letters and lowercase everything
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

// Build static icons map: name -> component (normalized to kebab-case)
const staticIcons: Record<string, Component> = {};
for (const [path, module] of Object.entries(staticIconModules)) {
  const rawName = getIconName(path);
  const normalizedName = toKebabCase(rawName);
  staticIcons[normalizedName] = module.default;
}

// Build animated icons map: name -> component (normalized to kebab-case)
const animatedIcons: Record<
  string,
  Component<{ triggerAnimation?: boolean }>
> = {};
for (const [path, module] of Object.entries(animatedIconModules)) {
  const rawName = getIconName(path);
  const normalizedName = toKebabCase(rawName);
  // The export name drops the `wide-` prefix and follows the pattern
  // Animated{PascalName}Icon (e.g. wide-sliders-horizontal ->
  // AnimatedSlidersHorizontalIcon).
  const baseName = normalizedName.replace(/^wide-/, '');
  const exportName = `Animated${toPascalCase(baseName)}Icon`;
  if (module[exportName]) {
    animatedIcons[normalizedName] = module[exportName];
  }
}

// Build the animated-icon list. Every icon with an animated (.tsx) version
// belongs here; its static (.svg) version is shown alongside when one exists.
type AnimatedIconEntry = {
  name: string;
  static?: Component;
  animated: Component<{ triggerAnimation?: boolean }>;
};

const ANIMATED_ICONS: AnimatedIconEntry[] = [];
for (const [name, animated] of Object.entries(animatedIcons)) {
  ANIMATED_ICONS.push({ name, static: staticIcons[name], animated });
}

// Sort alphabetically
ANIMATED_ICONS.sort((a, b) => a.name.localeCompare(b.name));

// Build static-only icons list (static icons without an animated version)
type StaticIcon = {
  name: string;
  component: Component;
};

const STATIC_ONLY_ICONS: StaticIcon[] = [];
for (const [name, component] of Object.entries(staticIcons)) {
  if (!animatedIcons[name]) {
    STATIC_ONLY_ICONS.push({ name, component });
  }
}

// Sort alphabetically
STATIC_ONLY_ICONS.sort((a, b) => a.name.localeCompare(b.name));

export default function IconGallery() {
  const [selectedColor, setSelectedColor] = createSignal<ColorOption>(
    THEME_COLORS[0]
  );
  const [customColor, setCustomColor] = createSignal('');
  const [iconSize, setIconSize] = createSignal(48);
  const [animationTriggers, setAnimationTriggers] = createSignal<
    Record<string, boolean>
  >({});

  // Get the actual CSS color value to apply
  const getColorStyle = () => {
    const color = selectedColor();
    if (color.value === 'custom') return customColor();
    return color.css;
  };

  const triggerAnimation = (name: string) => {
    setAnimationTriggers((prev) => ({ ...prev, [name]: true }));
    setTimeout(() => {
      setAnimationTriggers((prev) => ({ ...prev, [name]: false }));
    }, 1000);
  };

  const triggerAllAnimations = () => {
    const triggers: Record<string, boolean> = {};
    ANIMATED_ICONS.forEach((pair) => {
      triggers[pair.name] = true;
    });
    setAnimationTriggers(triggers);
    setTimeout(() => {
      setAnimationTriggers({});
    }, 1000);
  };

  return (
    <div class="size-full overflow-auto bg-surface p-8 font-mono">
      <style>{`
        .icon-gallery-slider {
          -webkit-appearance: none;
          appearance: none;
          background: linear-gradient(to right, var(--color-ink), var(--color-ink)) no-repeat center;
          background-size: 100% 1px;
          cursor: pointer;
          height: 12px;
        }
        .icon-gallery-slider::-webkit-slider-runnable-track {
          height: 1px;
          background: var(--color-ink);
        }
        .icon-gallery-slider::-moz-range-track {
          height: 1px;
          background: var(--color-ink);
        }
        .icon-gallery-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 2px;
          height: 9px;
          background: var(--color-ink);
          border: none;
          margin-top: -4px;
        }
        .icon-gallery-slider::-moz-range-thumb {
          width: 2px;
          height: 9px;
          background: var(--color-ink);
          border: none;
          border-radius: 0;
        }
      `}</style>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Icon Gallery" />
      </SplitHeaderLeft>
      <div class="mx-auto max-w-6xl">
        {/* Controls */}
        <div class="mb-6">
          {/* Color picker - 5 column grid of tiny rounded squares */}
          <div class="mb-3">
            <span class="mb-1.5 block text-xs text-ink">
              Color: <span class="text-ink-muted">{selectedColor().name}</span>
            </span>
            <div class="inline-grid grid-cols-5 gap-1">
              {/* Theme color swatches */}
              <For each={THEME_COLORS}>
                {(color) => (
                  <button
                    onClick={() => setSelectedColor(color)}
                    class="size-2.5 rounded-[1px] transition-transform hover:scale-125"
                    classList={{
                      'ring ring-ink ring-offset-1':
                        selectedColor().value === color.value,
                    }}
                    style={{ background: color.css }}
                    title={color.name}
                  />
                )}
              </For>
            </div>
            {/* Custom color option */}
            <div class="mt-1.5 flex items-center gap-1.5">
              <span class="text-xxs text-ink-muted">Custom</span>
              <label
                class="relative size-2.5 rounded-[1px] transition-transform hover:scale-125"
                classList={{
                  'ring ring-ink ring-offset-1':
                    selectedColor().value === 'custom',
                }}
                style={{
                  background: customColor() || 'transparent',
                  border: customColor()
                    ? 'none'
                    : '1px dashed var(--color-ink-muted)',
                }}
              >
                <input
                  type="color"
                  value={customColor() || '#000000'}
                  onInput={(e) => {
                    setCustomColor(e.currentTarget.value);
                    setSelectedColor({
                      name: 'Custom',
                      value: 'custom',
                      css: e.currentTarget.value,
                    });
                  }}
                  class="absolute inset-0 opacity-0"
                />
              </label>
            </div>
          </div>

          {/* Size and actions */}
          <div class="flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-2 text-xs text-ink">
              <span>Size:</span>
              <input
                type="range"
                min="10"
                max="200"
                value={iconSize()}
                onInput={(e) => setIconSize(Number(e.currentTarget.value))}
                class="icon-gallery-slider w-24"
              />
              <span class="w-8 text-xxs text-ink-muted">{iconSize()}px</span>
            </label>
            <button
              onClick={triggerAllAnimations}
              class="border border-ink bg-transparent px-2 py-1 text-xxs text-ink hover:opacity-70"
            >
              Trigger All Animations
            </button>
          </div>
        </div>

        {/* Icons with animated versions */}
        <h2 class="mb-3 flex items-center gap-3 text-xs font-semibold text-ink">
          <span>Icons with animations</span>
          <span class="h-px flex-1 bg-edge-muted" />
        </h2>
        <div class="mb-6 flex flex-wrap gap-3">
          <For each={ANIMATED_ICONS}>
            {(pair) => (
              <div class="inline-flex flex-col items-center rounded-[1px] border border-edge-muted p-2">
                <p class="mb-2 text-xxs text-ink">{pair.name}</p>
                <div class="flex items-center justify-center gap-3">
                  {/* Static version (shown when one exists) */}
                  <Show when={pair.static}>
                    {(staticComponent) => (
                      <div class="flex flex-col items-center">
                        <div
                          class="flex items-center justify-center"
                          style={{
                            color: getColorStyle(),
                            width: `${iconSize()}px`,
                            height: `${iconSize()}px`,
                          }}
                        >
                          <Dynamic component={staticComponent()} />
                        </div>
                        <span class="mt-2 text-[8px] text-ink-muted">
                          static
                        </span>
                      </div>
                    )}
                  </Show>
                  {/* Animated version */}
                  <div class="flex flex-col items-center">
                    <div
                      class="flex items-center justify-center"
                      style={{
                        color: getColorStyle(),
                        width: `${iconSize()}px`,
                        height: `${iconSize()}px`,
                      }}
                      onMouseEnter={() =>
                        setAnimationTriggers((prev) => ({
                          ...prev,
                          [pair.name]: true,
                        }))
                      }
                      onMouseLeave={() =>
                        setAnimationTriggers((prev) => ({
                          ...prev,
                          [pair.name]: false,
                        }))
                      }
                      title="Hover to animate"
                    >
                      <pair.animated
                        triggerAnimation={animationTriggers()[pair.name]}
                      />
                    </div>
                    <div class="mt-2 flex items-center gap-1">
                      <span class="text-[8px] text-ink-muted">animated</span>
                      <button
                        onClick={() => triggerAnimation(pair.name)}
                        class="flex size-2.5 items-center justify-center rounded-full border border-current text-ink-muted transition-colors hover:bg-ink/10 hover:text-ink"
                        title="Play animation"
                      >
                        <svg
                          width="4"
                          height="4"
                          viewBox="0 0 6 6"
                          fill="currentColor"
                        >
                          <path d="M1.5 0.5L5.5 3L1.5 5.5V0.5Z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>

        {/* Static-only icons */}
        <h2 class="mb-3 flex items-center gap-3 text-xs font-semibold text-ink">
          <span>Static only icons</span>
          <span class="h-px flex-1 bg-edge-muted" />
        </h2>
        <div class="flex flex-wrap gap-3">
          <For each={STATIC_ONLY_ICONS}>
            {(icon) => (
              <div class="inline-flex flex-col items-center rounded-[1px] border border-edge-muted p-2">
                <div
                  class="flex items-center justify-center"
                  style={{
                    color: getColorStyle(),
                    width: `${iconSize()}px`,
                    height: `${iconSize()}px`,
                  }}
                >
                  <icon.component />
                </div>
                <span class="mt-2 text-[8px] text-ink-muted">{icon.name}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
