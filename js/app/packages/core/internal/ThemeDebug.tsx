import { Button, Panel } from '@ui';
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

const BUTTON_VARIANTS = ['ghost', 'base', 'active', 'danger'] as const;
const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;

function ThemeDebug() {
  return (
    <div class="size-full overflow-auto bg-surface p-6">
      <div class="flex flex-col gap-8 max-w-6xl mx-auto">
        <h1 class="text-2xl font-bold text-ink">Theme Debug</h1>

        {/* Panel Depths Section */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">Panel Depths (0-5)</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <For each={[0, 1, 2, 3, 4, 5] as const}>
              {(depth) => (
                <Panel depth={depth} class="min-h-40">
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
          <Panel depth={0} class="p-4">
            <p class="text-xs text-ink-muted mb-2">Depth 0</p>
            <Panel depth={1} class="p-4">
              <p class="text-xs text-ink-muted mb-2">Depth 1</p>
              <Panel depth={2} class="p-4">
                <p class="text-xs text-ink-muted mb-2">Depth 2</p>
                <Panel depth={3} class="p-4">
                  <p class="text-xs text-ink-muted mb-2">Depth 3</p>
                  <Panel depth={4} class="p-4">
                    <p class="text-xs text-ink-muted mb-2">Depth 4</p>
                    <Panel depth={5} class="p-4">
                      <p class="text-xs text-ink-muted">Depth 5 (innermost)</p>
                    </Panel>
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
            Panels with the `active` prop show an accent border gradient.
          </p>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <For each={[1, 2, 3] as const}>
              {(depth) => (
                <Panel depth={depth} active class="min-h-32">
                  <Panel.Header>
                    <span class="text-sm font-medium text-ink">
                      Active Depth {depth}
                    </span>
                  </Panel.Header>
                  <Panel.Body class="p-4">
                    <p class="text-sm text-ink-muted">
                      Active panel with accent styling
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
            All button variants: ghost, base, active, and danger.
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
                              {size.toUpperCase()} Button
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

        {/* Button Sizes with Icons */}
        <section class="flex flex-col gap-4">
          <h2 class="text-xl font-semibold text-ink">Button Sizes</h2>
          <p class="text-sm text-ink-muted">
            All button sizes including icon variants.
          </p>

          <Panel depth={1}>
            <Panel.Body class="p-4">
              <div class="flex flex-col gap-4">
                <div class="flex flex-wrap gap-2 items-center">
                  <Button variant="base" size="sm">
                    Small
                  </Button>
                  <Button variant="base" size="md">
                    Medium
                  </Button>
                  <Button variant="base" size="lg">
                    Large
                  </Button>
                </div>
                <div class="flex flex-wrap gap-2 items-center">
                  <Button variant="base" size="icon-sm">
                    <svg
                      class="size-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M12 4v16m-8-8h16" />
                    </svg>
                  </Button>
                  <Button variant="base" size="icon-md">
                    <svg
                      class="size-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M12 4v16m-8-8h16" />
                    </svg>
                  </Button>
                  <Button variant="base" size="icon-lg">
                    <svg
                      class="size-6"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M12 4v16m-8-8h16" />
                    </svg>
                  </Button>
                </div>
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
                <Panel depth={depth}>
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
                      <Button variant="base" depth={depth}>
                        Base
                      </Button>
                      <Button variant="active" depth={depth}>
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

          <Panel depth={2} active>
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
              <Button variant="active" size="sm">
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
