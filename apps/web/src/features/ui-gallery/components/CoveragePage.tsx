import { Badge, Button, SegmentedControl } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import {
  AUDIT,
  type AuditComponent,
  isRoot,
  rootName,
  TOTAL_OVERRIDES,
  TOTAL_USAGES,
} from '../audit';
import { coverageRows, DOC_ENTRIES, type DocEntry } from '../registry';

/**
 * Restyle rate carries severity, so the meter steps accent -> warning -> failure.
 * The rate is always printed beside the bar, so the color is never the only
 * thing distinguishing one row from another.
 */
function severity(rate: number): string {
  if (rate >= 0.5) return 'var(--color-failure)';
  if (rate >= 0.25) return 'var(--color-warning)';
  return 'var(--color-accent)';
}

/** A single ratio against a limit: a meter, with the track a lighter step of
 *  the fill's own ramp so the state reads across the whole bar. */
function Meter(props: { rate: number; class?: string }) {
  const color = () => severity(props.rate);
  return (
    <div
      class={`h-1.5 rounded-full overflow-hidden ${props.class ?? ''}`}
      style={{
        'background-color': `color-mix(in oklch, ${color()} 15%, transparent)`,
      }}
    >
      <div
        class="h-full rounded-full"
        style={{
          width: `${Math.round(props.rate * 100)}%`,
          'background-color': color(),
        }}
      />
    </div>
  );
}

/** Headline number. Proportional figures — `tabular-nums` makes a large
 *  standalone value read loose. */
function StatTile(props: { label: string; value: string; note?: string }) {
  return (
    <div class="flex flex-col gap-1 rounded-md border border-edge-muted p-3">
      <span class="text-xs text-ink-subtle">{props.label}</span>
      <span class="text-2xl font-semibold text-ink">{props.value}</span>
      <Show when={props.note}>
        <span class="text-xs text-ink-subtle">{props.note}</span>
      </Show>
    </div>
  );
}

type Row = {
  name: string;
  entry: DocEntry | undefined;
  audit: AuditComponent | undefined;
};

export function CoveragePage(props: { onSelect: (slug: string) => void }) {
  const [scope, setScope] = createSignal<'roots' | 'all'>('roots');
  const [expanded, setExpanded] = createSignal<string | null>(null);

  const docRows = createMemo(() => coverageRows());
  const documented = createMemo(
    () => docRows().filter((row) => row.entry).length
  );

  const rows = createMemo<Row[]>(() => {
    const byName = new Map<string, Row>();

    // Every component file, so a never-used component still shows up.
    for (const row of docRows()) {
      byName.set(row.name, {
        name: row.name,
        entry: row.entry,
        audit: undefined,
      });
    }

    for (const component of AUDIT.components) {
      if (scope() === 'roots' && !isRoot(component.name)) continue;
      const existing = byName.get(component.name);
      if (existing) {
        existing.audit = component;
        continue;
      }
      const root = rootName(component.name);
      byName.set(component.name, {
        name: component.name,
        entry: DOC_ENTRIES.find(
          (entry) =>
            entry.doc.name === root || entry.doc.exports?.includes(root)
        ),
        audit: component,
      });
    }

    // Most-used first: an undocumented component with 500 call sites is the
    // one worth writing up next.
    return [...byName.values()].sort(
      (a, b) => (b.audit?.usages ?? 0) - (a.audit?.usages ?? 0)
    );
  });

  const overallRate = () =>
    TOTAL_USAGES === 0 ? 0 : TOTAL_OVERRIDES / TOTAL_USAGES;

  const buttons = () =>
    AUDIT.handRolled.find((entry) => entry.element === 'button');

  return (
    <article class="flex flex-col gap-8 max-w-4xl">
      <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold text-ink">Coverage & adoption</h1>
        <p class="text-sm text-ink-muted">
          How much of the app actually uses the library, and where call sites
          have to reskin a component to make it fit. A high restyle rate means
          the component's own API is missing something.
        </p>
        <p class="text-xs text-ink-subtle">
          {AUDIT.scannedFiles.toLocaleString()} files scanned ·{' '}
          {new Date(AUDIT.generatedAt).toLocaleDateString()} · regenerate with{' '}
          <code class="font-mono">bun run ui-audit</code>
        </p>
      </header>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Components documented"
          value={`${documented()} / ${docRows().length}`}
          note={`${Math.round((documented() / Math.max(docRows().length, 1)) * 100)}% of the library`}
        />
        <StatTile
          label="Library call sites"
          value={TOTAL_USAGES.toLocaleString()}
          note="JSX usages across the app"
        />
        <StatTile
          label="Restyled at call site"
          value={`${Math.round(overallRate() * 100)}%`}
          note={`${TOTAL_OVERRIDES.toLocaleString()} usages override visuals`}
        />
        <StatTile
          label="Hand-rolled buttons"
          value={(buttons()?.usages ?? 0).toLocaleString()}
          note={`vs ${(buttons()?.libraryUsages ?? 0).toLocaleString()} <Button>`}
        />
      </div>

      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-4">
          <h2 class="text-lg font-semibold text-ink">By component</h2>
          <SegmentedControl
            size="sm"
            aria-label="Component scope"
            value={scope()}
            onChange={setScope}
            options={[
              { value: 'roots', label: 'Components' },
              { value: 'all', label: 'Include slots' },
            ]}
          />
        </div>

        <div class="overflow-x-auto rounded-md border border-edge-muted">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="bg-inset">
                <th class="px-3 py-2 text-left font-medium text-ink-subtle">
                  Component
                </th>
                <th class="px-3 py-2 text-right font-medium text-ink-subtle">
                  Files
                </th>
                <th class="px-3 py-2 text-right font-medium text-ink-subtle">
                  Uses
                </th>
                <th class="px-3 py-2 text-left font-medium text-ink-subtle w-44">
                  Restyled
                </th>
                <th class="px-3 py-2 text-left font-medium text-ink-subtle">
                  Docs
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(row) => (
                  <>
                    <tr class="border-t border-edge-muted">
                      <td class="px-3 py-2">
                        <button
                          type="button"
                          class="font-mono text-ink text-left hover:text-accent"
                          disabled={!row.audit?.sites.length}
                          onClick={() =>
                            setExpanded(
                              expanded() === row.name ? null : row.name
                            )
                          }
                        >
                          {row.name}
                        </button>
                      </td>
                      <td class="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {row.audit?.files ?? 0}
                      </td>
                      <td class="px-3 py-2 text-right tabular-nums text-ink">
                        {row.audit?.usages ?? 0}
                      </td>
                      <td class="px-3 py-2">
                        <Show
                          when={row.audit && row.audit.usages > 0}
                          fallback={<span class="text-ink-subtle">—</span>}
                        >
                          <div class="flex items-center gap-2">
                            <Meter
                              rate={row.audit!.overrideRate}
                              class="flex-1 min-w-16"
                            />
                            <span class="tabular-nums text-xs text-ink w-9 text-right">
                              {Math.round(row.audit!.overrideRate * 100)}%
                            </span>
                          </div>
                          <Show when={row.audit!.topOverrides.length}>
                            <div class="mt-1 font-mono text-xs text-ink-subtle truncate">
                              {row
                                .audit!.topOverrides.slice(0, 3)
                                .map((entry) => `${entry.token}×${entry.count}`)
                                .join('  ')}
                            </div>
                          </Show>
                        </Show>
                      </td>
                      <td class="px-3 py-2">
                        <Show
                          when={row.entry}
                          fallback={
                            <Badge
                              variant="outline"
                              size="sm"
                              class="text-ink-subtle"
                            >
                              None
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
                      </td>
                    </tr>
                    <Show when={expanded() === row.name && row.audit}>
                      {(audit) => (
                        <tr class="border-t border-edge-muted bg-inset">
                          <td colspan="5" class="px-3 py-2">
                            <p class="mb-2 text-xs text-ink-subtle">
                              Call sites that override visuals
                              <Show when={audit().truncatedSites}>
                                {' '}
                                (first {audit().sites.length} of{' '}
                                {audit().sites.length + audit().truncatedSites})
                              </Show>
                            </p>
                            <ul class="flex flex-col gap-1">
                              <For each={audit().sites}>
                                {(site) => (
                                  <li class="font-mono text-xs text-ink-muted">
                                    {site.file}:{site.line}
                                    <span class="ml-2 text-ink-subtle">
                                      {site.classes}
                                    </span>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Show>
                  </>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold text-ink">Hand-rolled primitives</h2>
        <p class="text-sm text-ink-muted">
          Intrinsic elements used where a library component exists — or where
          one does not exist yet, which is a gap in the library rather than a
          call site ignoring it.
        </p>
        <div class="flex flex-col gap-3">
          <For each={AUDIT.handRolled}>
            {(entry) => {
              const total = entry.usages + (entry.libraryUsages ?? 0);
              const share = total === 0 ? 0 : entry.usages / total;
              return (
                <div class="flex flex-col gap-1.5 rounded-md border border-edge-muted p-3">
                  <div class="flex items-baseline justify-between gap-3">
                    <span class="font-mono text-sm text-ink">
                      &lt;{entry.element}&gt;
                    </span>
                    <Show
                      when={entry.suggested}
                      fallback={
                        <span class="text-xs text-ink-subtle">
                          no library component exists yet
                        </span>
                      }
                    >
                      {(suggested) => (
                        <span class="text-xs text-ink-subtle tabular-nums">
                          {entry.usages} hand-rolled vs {entry.libraryUsages}{' '}
                          &lt;{suggested()}&gt;
                        </span>
                      )}
                    </Show>
                  </div>
                  <Show
                    when={entry.suggested}
                    fallback={
                      <span class="text-xs text-ink-muted tabular-nums">
                        {entry.usages} usages across {entry.files} files
                      </span>
                    }
                  >
                    <div class="flex items-center gap-2">
                      <Meter rate={share} class="flex-1" />
                      <span class="w-9 text-right text-xs tabular-nums text-ink">
                        {Math.round(share * 100)}%
                      </span>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </section>
    </article>
  );
}
