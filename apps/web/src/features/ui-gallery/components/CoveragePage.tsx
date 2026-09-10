import { Badge, Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { coverageRows } from '../registry';

/**
 * Which `@ui` components have a docs page and which do not.
 *
 * Usage and restyle data deliberately lives in the `ui-audit` CLI rather than
 * here — it is a whole-codebase scan, and the terminal is where you act on it.
 * Run `bun run ui-audit`.
 */
export function CoveragePage(props: { onSelect: (slug: string) => void }) {
  const rows = createMemo(() => coverageRows());
  const documented = createMemo(() => rows().filter((row) => row.entry).length);
  const percent = createMemo(() =>
    rows().length === 0 ? 0 : Math.round((documented() / rows().length) * 100)
  );

  return (
    <article class="flex flex-col gap-6 max-w-3xl">
      <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold text-ink">Coverage</h1>
        <p class="text-sm text-ink-muted">
          {documented()} of {rows().length} components in{' '}
          <code class="font-mono text-xs">src/components/ui/components</code>{' '}
          have a page ({percent()}%). Add one by dropping a{' '}
          <code class="font-mono text-xs">&lt;Name&gt;.docs.tsx</code> file
          beside the component — the sidebar picks it up automatically.
        </p>
        <p class="text-xs text-ink-subtle">
          For how much each component is actually used, and where call sites
          have to reskin one, run{' '}
          <code class="font-mono">bun run ui-audit</code>.
        </p>
      </header>

      <div
        class="h-1.5 w-full rounded-full bg-inset overflow-hidden"
        role="progressbar"
        aria-valuenow={percent()}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Documentation coverage"
      >
        <div class="h-full bg-accent" style={{ width: `${percent()}%` }} />
      </div>

      <ul class="flex flex-col rounded-md border border-edge-muted overflow-hidden">
        <For each={rows()}>
          {(row) => (
            <li class="flex items-center justify-between gap-3 px-3 py-2 border-b border-edge-muted last:border-b-0">
              <span class="font-mono text-sm text-ink">{row.name}</span>
              <Show
                when={row.entry}
                fallback={
                  <Badge variant="outline" size="sm" class="text-ink-subtle">
                    Undocumented
                  </Badge>
                }
              >
                {(entry) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => props.onSelect(entry().slug)}
                  >
                    {entry().doc.name}
                  </Button>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </article>
  );
}
