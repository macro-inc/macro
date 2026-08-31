import CaretDownIcon from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import CellSignalHighIcon from '@phosphor-icons/core/regular/cell-signal-high.svg?component-solid';
import CheckIcon from '@phosphor-icons/core/regular/check.svg?component-solid';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg?component-solid';
import { Badge, Button, Panel } from '@ui';
import { For } from 'solid-js';

const LOREM_SHORT = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
const LOREM_MEDIUM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.';

const TEXT_SIZES = [
  { name: 'text-xs', class: 'text-xs' },
  { name: 'text-sm', class: 'text-sm' },
  { name: 'text-base', class: 'text-base' },
  { name: 'text-lg', class: 'text-lg' },
  { name: 'text-xl', class: 'text-xl' },
  { name: 'text-2xl', class: 'text-2xl' },
] as const;

const INK_VARIANTS = [
  { name: 'text-ink', class: 'text-ink' },
  { name: 'text-ink-muted', class: 'text-ink-muted' },
  { name: 'text-ink-extra-muted', class: 'text-ink-extra-muted' },
  { name: 'text-ink-disabled', class: 'text-ink-disabled' },
  { name: 'text-ink-placeholder', class: 'text-ink-placeholder' },
] as const;

const BUTTON_VARIANTS = [
  'ghost',
  'outline',
  'accent',
  'strong',
  'danger',
  'cta',
] as const;
const BUTTON_CONTENT_VARIANTS = ['outline', 'accent', 'strong', 'cta'] as const;
const BUTTON_SIZES = ['sm', 'md', 'lg', 'xl'] as const;
const BADGE_SIZES = ['sm', 'md', 'lg'] as const;
const BADGE_VARIANTS = ['ghost', 'outline'] as const;
const BUTTON_SIZE_LABELS = {
  sm: 'Small',
  md: 'Default',
  lg: 'Large',
  xl: 'Extra Large',
} as const;

function ThemeDebug() {
  return (
    <div class="size-full overflow-auto p-6">
      <div class="flex flex-col gap-8 max-w-6xl mx-auto">
        <h1 class="text-2xl font-bold text-ink">Theme Debug</h1>

        {/* Panel Depths Section */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">Panel Depths (0-4)</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <For each={[0, 1, 2, 3, 4] as const}>
              {(depth) => (
                <Panel depth={depth} class="min-h-40 bg-surface">
                  <Panel.Header>
                    <span class="text-sm font-medium text-ink">
                      Depth {depth}
                    </span>
                  </Panel.Header>
                  <Panel.Body class="p-4">
                    <p class="text-sm text-ink-muted">{LOREM_SHORT}</p>
                  </Panel.Body>
                </Panel>
              )}
            </For>
          </div>

          {/* Nested panels to show depth hierarchy */}
          <h3 class="text-lg font-medium text-ink mt-4">Nested Panel Depths</h3>
          <Panel depth={0} class="bg-surface p-4">
            <p class="text-xs text-ink-muted mb-2">Depth 0</p>
            <Panel depth={1} class="bg-surface p-4">
              <p class="text-xs text-ink-muted mb-2">Depth 1</p>
              <Panel depth={2} class="bg-surface p-4">
                <p class="text-xs text-ink-muted mb-2">Depth 2</p>
                <Panel depth={3} class="bg-surface p-4">
                  <p class="text-xs text-ink-muted mb-2">Depth 3</p>
                  <Panel depth={4} class="bg-surface p-4">
                    <p class="text-xs text-ink-muted">Depth 4 (innermost)</p>
                  </Panel>
                </Panel>
              </Panel>
            </Panel>
          </Panel>
        </section>

        {/* Active Panels */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">Active Panels</h2>
          <p class="text-sm text-ink-muted">
            Panels with the `active` prop show the active focus ring.
          </p>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <For each={[1, 2, 3] as const}>
              {(depth) => (
                <Panel active depth={depth} class="min-h-32 bg-surface">
                  <Panel.Header>
                    <span class="text-sm font-medium text-ink">
                      Active Depth {depth}
                    </span>
                  </Panel.Header>
                  <Panel.Body class="p-4">
                    <p class="text-sm text-ink-muted">
                      Active panel using its layer-relative surface
                    </p>
                  </Panel.Body>
                </Panel>
              )}
            </For>
          </div>
        </section>

        {/* Text Sizes Section */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">Text Sizes</h2>
          <p class="text-sm text-ink-muted">Major text sizes from xs to 2xl.</p>

          <Panel depth={1}>
            <Panel.Body class="p-4">
              <div class="flex flex-col gap-4">
                <For each={TEXT_SIZES}>
                  {(size) => (
                    <div class="flex flex-col gap-1">
                      <span class="text-xs text-ink-extra-muted font-mono">
                        {size.name}
                      </span>
                      <p class={`${size.class} text-ink`}>{LOREM_SHORT}</p>
                    </div>
                  )}
                </For>
              </div>
            </Panel.Body>
          </Panel>
        </section>

        {/* Ink Variants Section */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">Ink Color Variants</h2>
          <p class="text-sm text-ink-muted">
            Text colors from ink (primary) to ink-placeholder (lowest contrast).
          </p>

          <Panel depth={1}>
            <Panel.Body class="p-4">
              <div class="flex flex-col gap-4">
                <For each={INK_VARIANTS}>
                  {(variant) => (
                    <div class="flex flex-col gap-1">
                      <span class="text-xs text-ink-extra-muted font-mono">
                        {variant.name}
                      </span>
                      <p class={`text-base ${variant.class}`}>{LOREM_MEDIUM}</p>
                    </div>
                  )}
                </For>
              </div>
            </Panel.Body>
          </Panel>
        </section>

        {/* Combined Text Matrix */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">
            Text Size × Ink Variant Matrix
          </h2>
          <p class="text-sm text-ink-muted">
            All combinations of text sizes and ink variants.
          </p>

          <Panel depth={1}>
            <Panel.Body scroll class="max-h-96">
              <div class="p-4">
                <table class="w-full border-collapse">
                  <thead>
                    <tr>
                      <th class="text-left text-xs text-ink-muted p-2 border-b border-edge-muted">
                        Size / Ink
                      </th>
                      <For each={INK_VARIANTS}>
                        {(ink) => (
                          <th class="text-left text-xs text-ink-muted p-2 border-b border-edge-muted font-mono">
                            {ink.name.replace('text-', '')}
                          </th>
                        )}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={TEXT_SIZES}>
                      {(size) => (
                        <tr>
                          <td class="text-xs text-ink-muted p-2 border-b border-edge-muted font-mono">
                            {size.name}
                          </td>
                          <For each={INK_VARIANTS}>
                            {(ink) => (
                              <td
                                class={`p-2 border-b border-edge-muted ${size.class} ${ink.class}`}
                              >
                                Aa
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Panel.Body>
          </Panel>
        </section>

        {/* Button Variants Section */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">Button Variants</h2>
          <p class="text-sm text-ink-muted">
            All button variants: ghost, outline, accent, strong, danger, and
            CTA.
          </p>

          <Panel depth={1}>
            <Panel.Body class="p-4">
              <div class="flex flex-col gap-6">
                <For each={BUTTON_VARIANTS}>
                  {(variant) => (
                    <div class="flex flex-col gap-2">
                      <span class="text-xs text-ink-extra-muted font-mono">
                        variant="{variant}"
                      </span>
                      <div class="flex flex-wrap gap-2 items-center">
                        <For each={BUTTON_SIZES}>
                          {(size) => (
                            <Button variant={variant} size={size}>
                              {BUTTON_SIZE_LABELS[size]}
                            </Button>
                          )}
                        </For>
                        <Button variant={variant} disabled>
                          Disabled
                        </Button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Panel.Body>
          </Panel>
        </section>

        {/* Button content and size combinations */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">
            Button Size × Content Matrix
          </h2>
          <p class="text-sm text-ink-muted">
            Icon-only, text-only, and icon + text buttons use the same size prop
            and share a height within each row.
          </p>

          <Panel depth={1}>
            <Panel.Body class="p-4">
              <div class="flex flex-col gap-6">
                <For each={BUTTON_SIZES}>
                  {(size) => (
                    <div class="flex flex-col items-start gap-2">
                      <span class="text-xs text-ink-extra-muted font-mono">
                        size="{size}"
                      </span>
                      <div class="flex flex-col items-start gap-3">
                        <For each={BUTTON_CONTENT_VARIANTS}>
                          {(variant) => (
                            <div class="flex flex-col items-start gap-1.5">
                              <span class="text-xs text-ink-extra-muted font-mono">
                                variant="{variant}"
                              </span>
                              <div class="flex flex-wrap items-end gap-4">
                                <div class="flex flex-col items-start gap-1.5">
                                  <span class="text-xs text-ink-extra-muted">
                                    Icon only
                                  </span>
                                  <Button
                                    variant={variant}
                                    size={size}
                                    square
                                    label={`Add (${variant}, ${size})`}
                                  >
                                    <PlusIcon />
                                  </Button>
                                </div>
                                <div class="flex flex-col items-start gap-1.5">
                                  <span class="text-xs text-ink-extra-muted">
                                    Text only
                                  </span>
                                  <Button variant={variant} size={size}>
                                    Button
                                  </Button>
                                </div>
                                <div class="flex flex-col items-start gap-1.5">
                                  <span class="text-xs text-ink-extra-muted">
                                    Icon + text
                                  </span>
                                  <Button variant={variant} size={size}>
                                    <PlusIcon />
                                    Button
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Panel.Body>
          </Panel>
        </section>

        {/* Badge variants and sizes */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">Badge Variants</h2>
          <p class="text-sm text-ink-muted">
            Ghost and outline badges share the Button sm, md, and lg size
            definitions.
          </p>

          <Panel depth={1}>
            <Panel.Body class="p-4">
              <div class="flex flex-col gap-6">
                <div class="flex flex-col items-start gap-2">
                  <span class="text-xs text-ink-extra-muted font-mono">
                    Content samples · size="sm"
                  </span>
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" size="sm">
                      <span
                        aria-hidden="true"
                        class="size-2 rounded-full bg-folder"
                      />
                      tags
                    </Badge>
                    <Badge variant="outline" size="sm">
                      <span
                        aria-hidden="true"
                        class="size-2 rounded-full bg-snippet"
                      />
                      tags-ux
                    </Badge>
                    <Badge variant="outline" size="sm">
                      <span class="inline-flex size-[1em] items-center justify-center rounded-full bg-snippet text-surface-4">
                        <CheckIcon aria-hidden="true" class="size-[0.65em]" />
                      </span>
                      Completed
                      <CaretDownIcon aria-hidden="true" />
                    </Badge>
                    <Badge variant="outline" size="sm">
                      <CellSignalHighIcon aria-hidden="true" />
                      High
                      <CaretDownIcon aria-hidden="true" />
                    </Badge>
                  </div>
                </div>
                <For each={BADGE_SIZES}>
                  {(size) => (
                    <div class="flex flex-col items-start gap-2">
                      <span class="text-xs text-ink-extra-muted font-mono">
                        size="{size}"
                      </span>
                      <div class="flex flex-wrap items-end gap-4">
                        <For each={BADGE_VARIANTS}>
                          {(variant) => (
                            <div class="flex flex-col items-start gap-1.5">
                              <span class="text-xs text-ink-extra-muted font-mono">
                                variant="{variant}"
                              </span>
                              <div class="flex flex-wrap items-center gap-2">
                                <Badge variant={variant} size={size}>
                                  Badge
                                </Badge>
                                <Badge variant={variant} size={size}>
                                  <PlusIcon />
                                  Badge
                                </Badge>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Panel.Body>
          </Panel>
        </section>

        {/* Buttons at Different Depths */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">
            Buttons at Panel Depths
          </h2>
          <p class="text-sm text-ink-muted">
            Buttons can specify a depth prop for proper layering.
          </p>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <For each={[1, 2, 3, 4] as const}>
              {(depth) => (
                <Panel depth={depth} class="bg-surface">
                  <Panel.Header>
                    <span class="text-sm font-medium text-ink">
                      Panel Depth {depth}
                    </span>
                  </Panel.Header>
                  <Panel.Body class="p-4">
                    <div class="flex flex-wrap gap-2">
                      <Button variant="ghost" depth={depth}>
                        Ghost
                      </Button>
                      <Button variant="outline" depth={depth}>
                        Base
                      </Button>
                      <Button variant="accent" depth={depth}>
                        Active
                      </Button>
                      <Button variant="danger" depth={depth}>
                        Danger
                      </Button>
                    </div>
                  </Panel.Body>
                </Panel>
              )}
            </For>
          </div>
        </section>

        {/* Full Example Card */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">Complete Card Example</h2>
          <p class="text-sm text-ink-muted">
            A complete panel with header, body, and footer.
          </p>

          <Panel depth={2}>
            <Panel.Header class="px-4">
              <span class="text-sm font-semibold text-ink">Card Title</span>
            </Panel.Header>
            <Panel.Body class="p-4">
              <p class="text-base text-ink mb-2">{LOREM_SHORT}</p>
              <p class="text-sm text-ink-muted">{LOREM_MEDIUM}</p>
            </Panel.Body>
            <Panel.Footer class="px-4 justify-end gap-2">
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
              <Button variant="accent" size="sm">
                Confirm
              </Button>
            </Panel.Footer>
          </Panel>
        </section>
      </div>
    </div>
  );
}

export default ThemeDebug;
