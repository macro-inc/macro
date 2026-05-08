/**
 * Ring Shootout Demo
 * Compares two card edge styles: border-edge vs ring-edge
 * Both with shadow-lg for visual comparison
 */
export default function RingShootoutDemo() {
  return (
    <div class="size-full bg-panel p-8 flex flex-col gap-8">
      <div class="text-center">
        <h1 class="text-2xl font-bold text-ink mb-2">Ring vs Border Shootout</h1>
        <p class="text-ink-muted text-sm">
          Comparing two card edge styles with shadow-lg
        </p>
      </div>

      <div class="flex flex-1 gap-8 justify-center items-start">
        {/* Border Edge Card */}
        <div class="flex flex-col gap-3 items-center">
          <div class="text-sm font-mono text-ink-muted bg-edge px-2 py-1 rounded">
            border border-[green]
          </div>
          <div class="w-80 bg-menu border border-[green] shadow-lg shadow-[green] rounded-lg p-6">
            <h2 class="text-lg font-semibold text-ink mb-3">Border Edge Card</h2>
            <p class="text-ink-muted text-sm mb-4">
              This card uses the traditional <code class="bg-edge px-1 rounded text-xs">border border-edge</code> styling
              for its edge definition.
            </p>
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <div class="size-2 rounded-full bg-success" />
                <span class="text-sm text-ink">Explicit border width</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="size-2 rounded-full bg-success" />
                <span class="text-sm text-ink">Part of box model</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="size-2 rounded-full bg-warning" />
                <span class="text-sm text-ink">Affects layout sizing</span>
              </div>
            </div>
            <button class="mt-4 w-full py-2 px-4 bg-accent text-panel rounded hover:bg-accent/90 transition-colors text-sm font-medium">
              Action Button
            </button>
          </div>
        </div>

        {/* Ring Edge Card */}
        <div class="flex flex-col gap-3 items-center">
          <div class="text-sm font-mono text-ink-muted bg-edge px-2 py-1 rounded">
            ring ring-[green]
          </div>
          <div class="w-80 bg-menu ring ring-[green] shadow-lg shadow-[green] rounded-lg p-6">
            <h2 class="text-lg font-semibold text-ink mb-3">Ring Edge Card</h2>
            <p class="text-ink-muted text-sm mb-4">
              This card uses the <code class="bg-edge px-1 rounded text-xs">ring ring-edge</code> styling
              for its edge definition.
            </p>
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <div class="size-2 rounded-full bg-success" />
                <span class="text-sm text-ink">Box-shadow based</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="size-2 rounded-full bg-success" />
                <span class="text-sm text-ink">No layout impact</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="size-2 rounded-full bg-success" />
                <span class="text-sm text-ink">Composable with shadows</span>
              </div>
            </div>
            <button class="mt-4 w-full py-2 px-4 bg-accent text-panel rounded hover:bg-accent/90 transition-colors text-sm font-medium">
              Action Button
            </button>
          </div>
        </div>
      </div>

      {/* Additional comparison section */}
      <div class="flex gap-8 justify-center">
        {/* Border with muted variant */}
        <div class="flex flex-col gap-3 items-center">
          <div class="text-sm font-mono text-ink-muted bg-edge px-2 py-1 rounded">
            border border-[green]
          </div>
          <div class="w-64 bg-menu border border-[green] shadow-lg shadow-[green] rounded-lg p-4">
            <h3 class="text-base font-semibold text-ink mb-2">Muted Border</h3>
            <p class="text-ink-muted text-xs">
              Softer edge definition with border-edge-muted.
            </p>
          </div>
        </div>

        {/* Ring with muted variant */}
        <div class="flex flex-col gap-3 items-center">
          <div class="text-sm font-mono text-ink-muted bg-edge px-2 py-1 rounded">
            ring-1 ring-[green]
          </div>
          <div class="w-64 bg-menu ring-1 ring-[green] shadow-lg shadow-[green] rounded-lg p-4">
            <h3 class="text-base font-semibold text-ink mb-2">Muted Ring</h3>
            <p class="text-ink-muted text-xs">
              Softer edge definition with ring-edge-muted.
            </p>
          </div>
        </div>

        {/* Ring with thicker variant */}
        <div class="flex flex-col gap-3 items-center">
          <div class="text-sm font-mono text-ink-muted bg-edge px-2 py-1 rounded">
            ring-2 ring-[green]
          </div>
          <div class="w-64 bg-menu ring-2 ring-[green] shadow-lg shadow-
