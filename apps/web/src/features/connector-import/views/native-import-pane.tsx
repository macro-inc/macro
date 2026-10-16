import { SearchBar } from '@app/components/view-shell';
import { toast } from '@core/component/Toast/Toast';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import type { ImportSource } from '@service-cognition/import';
import { ActionDialogShell, Button } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import { ImportItemList } from '../components/import-item-list';
import { SecurityNote } from '../components/security-note';
import { useConnectorImport } from '../context/connector-import-context';
import { importItems, importRun, needsDiscovery } from '../core/import-items';
import type { ImportProvider } from '../core/providers';

const FILTER_THRESHOLD = 8;

/**
 * Pick-and-import for a provider the import pipeline copies natively:
 * discovery stages candidates, the user selects, accepted rows import live.
 */
export function NativeImportPane(props: {
  provider: ImportProvider & { native: ImportSource };
  onBack(): void;
  /** A row this pane submitted finished importing. */
  onImported(): void;
}): JSX.Element {
  const context = useConnectorImport();
  const importState = context.createImportState();
  const source = () => props.provider.native;
  const run = () => importRun(importState.state(), source());
  const items = createMemo(() => importItems(importState.state(), source()));
  const [filter, setFilter] = createSignal('');
  // Slack discovery lists every visible channel; long lists get a filter.
  const filterable = () => items().length > FILTER_THRESHOLD;
  const visible = createMemo(() => {
    const query = filter().trim().toLowerCase();
    if (!query) return items();
    return items().filter((item) =>
      `${item.title} ${item.detail ?? ''}`.toLowerCase().includes(query)
    );
  });
  const staged = () => visible().filter((item) => item.status === 'staged');
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = createSignal<ReadonlySet<string>>(
    new Set()
  );
  const [discovering, setDiscovering] = createSignal(false);
  const [importing, setImporting] = createSignal(false);
  const searching = () => discovering() || run()?.status === 'running' || false;
  // Status changes can make a selected row no longer importable.
  // Selections stay importable while the filter hides them.
  const importIds = () =>
    items()
      .filter((item) => item.status === 'staged' && selected().has(item.id))
      .map((item) => item.id);
  const allSelected = () =>
    staged().length > 0 && staged().every((item) => selected().has(item.id));

  async function discover() {
    if (searching()) return;
    setDiscovering(true);
    try {
      await context.discover(source());
    } catch {
      toast.failure(`Couldn't search ${props.provider.name}`);
    } finally {
      setDiscovering(false);
    }
  }

  async function runImport() {
    const ids = importIds();
    if (!ids.length || importing()) return;
    setImporting(true);
    try {
      await context.runImport(ids);
      setSubmitted((previous) => new Set([...previous, ...ids]));
      setSelected(new Set<string>());
    } catch {
      toast.failure(`Couldn't import from ${props.provider.name}`);
    } finally {
      setImporting(false);
    }
  }

  // Search once the real state is known, unless there is already a list.
  createEffect(
    on(
      importState.ready,
      (ready) => {
        if (ready && needsDiscovery(run(), items())) void discover();
      },
      { defer: false }
    )
  );

  // The run mutation only queues work; wait for a server-confirmed import.
  createEffect(() => {
    if (
      items().some(
        (item) => item.status === 'imported' && submitted().has(item.id)
      )
    ) {
      props.onImported();
    }
  });

  function select(id: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <ActionDialogShell class="max-h-[85dvh]">
      <ActionDialogShell.Body class="space-y-4">
        <ActionDialogShell.Header>
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to apps"
              onClick={() => props.onBack()}
            >
              <ArrowLeftIcon aria-hidden="true" />
            </Button>
            <ActionDialogShell.Title>
              Import from {props.provider.name}
            </ActionDialogShell.Title>
          </div>
          <ActionDialogShell.Description>
            Pick what to copy into Macro. Copies don't sync back to{' '}
            {props.provider.name}.
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>

        <Switch>
          <Match when={run()?.status === 'failed' && !searching()}>
            <div
              class="flex items-start gap-2 rounded-lg border border-edge-muted p-3 text-sm text-ink-muted"
              role="alert"
            >
              <WarningIcon
                class="mt-0.5 size-4 shrink-0 text-failure"
                aria-hidden="true"
              />
              <span>
                {run()?.error ?? `Couldn't search ${props.provider.name}.`}
              </span>
            </div>
          </Match>
          <Match when={searching() && !items().length}>
            <p
              class="flex items-center gap-2 py-6 text-sm text-ink-muted"
              role="status"
            >
              <SpinnerIcon class="size-4 animate-spin" aria-hidden="true" />
              Finding your recent {props.provider.detail.toLowerCase()} in{' '}
              {props.provider.name}…
            </p>
          </Match>
          <Match when={!items().length && importState.ready()}>
            <p class="py-6 text-sm text-ink-muted">
              Nothing new to import from {props.provider.name}.
            </p>
          </Match>
        </Switch>

        <Show when={items().length}>
          <Show when={filterable()}>
            <SearchBar
              label={`Filter ${props.provider.detail.toLowerCase()}`}
              placeholder={`Filter ${props.provider.detail.toLowerCase()}`}
              value={filter()}
              onValueChange={setFilter}
            />
          </Show>
          <Show when={staged().length > 1}>
            <Button
              variant="ghost"
              size="xs"
              disabled={importing()}
              onClick={() => {
                // Only the rows the filter shows; hidden selections stay.
                const shown = staged().map((item) => item.id);
                const clear = allSelected();
                setSelected((previous) => {
                  const next = new Set(previous);
                  for (const id of shown) {
                    if (clear) next.delete(id);
                    else next.add(id);
                  }
                  return next;
                });
              }}
            >
              {allSelected() ? 'Clear selection' : 'Select all'}
            </Button>
          </Show>
          <ImportItemList
            items={visible()}
            selected={selected()}
            disabled={importing()}
            onSelect={select}
            href={context.entityHref}
          />
          <Show when={searching()}>
            <p
              class="flex items-center gap-2 text-xs text-ink-muted"
              role="status"
            >
              <SpinnerIcon class="size-3 animate-spin" aria-hidden="true" />
              Looking for more…
            </p>
          </Show>
        </Show>
        <SecurityNote />
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        <Button
          variant="ghost"
          depth={2}
          disabled={searching() || importing()}
          onClick={() => void discover()}
        >
          Search again
        </Button>
        <Button
          variant="strong"
          depth={2}
          disabled={!importIds().length || importing()}
          onClick={() => void runImport()}
        >
          {importIds().length ? `Import ${importIds().length}` : 'Import'}
        </Button>
      </ActionDialogShell.Footer>
    </ActionDialogShell>
  );
}
