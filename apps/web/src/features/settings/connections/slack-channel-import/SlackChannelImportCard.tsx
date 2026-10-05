import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { buildSimpleEntityUrl } from '@core/util/url';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import {
  type ImportState,
  useDiscoverMutation,
  useImportQuery,
  useRunImportMutation,
} from '@queries/import';
import { Button } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { SettingsCard, SettingsSection } from '../primitives';
import {
  buildRows,
  filterRows,
  matchLabel,
  runLabel,
  type SlackChannelRow,
  selectableIds,
} from './model';

const EMPTY_STATE: ImportState = { runs: [], entities: [] };

type ChannelRowProps = {
  row: SlackChannelRow;
  selected: boolean;
  disabled: boolean;
  onSelect(selected: boolean): void;
};

function ChannelRow(props: ChannelRowProps): JSX.Element {
  const href = () => {
    const { entityId, entityType } = props.row;
    if (!entityId || !entityType) return undefined;
    return buildSimpleEntityUrl({ id: entityId, type: entityType });
  };

  return (
    <li class="flex items-start gap-3 py-3 text-sm">
      <Show when={props.row.status === 'staged'}>
        <input
          type="checkbox"
          class="mt-1 shrink-0"
          aria-label={`Select ${props.row.name}`}
          checked={props.selected}
          disabled={props.disabled}
          onChange={(event) => props.onSelect(event.currentTarget.checked)}
        />
      </Show>
      <div class="min-w-0 flex-1 break-words">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">{props.row.name}</span>
          <Show when={props.row.archived}>
            <span class="rounded bg-ink/5 px-1.5 py-0.5 text-xs text-ink-muted">
              Archived
            </span>
          </Show>
        </div>
        <Show when={props.row.purpose}>
          <p class="text-ink-muted">{props.row.purpose}</p>
        </Show>
        <p class="text-xs text-ink-muted">{matchLabel(props.row)}</p>
        <Show when={props.row.status === 'importing'}>
          <span
            class="mt-1 inline-flex items-center gap-1 text-ink-muted"
            role="status"
          >
            <SpinnerIcon class="size-3 animate-spin" aria-hidden="true" />
            Importing…
          </span>
        </Show>
        <Show when={props.row.status === 'imported'}>
          <p class="mt-1 text-ink-muted">
            <Show when={href()} fallback="Imported">
              {(url) => (
                <a
                  href={url()}
                  class="text-accent underline"
                  aria-label={`Open imported channel ${props.row.name}`}
                >
                  Imported
                </a>
              )}
            </Show>
            {props.row.importedByTeammate ? ' by a teammate' : ''}
          </p>
        </Show>
      </div>
    </li>
  );
}

export function SlackChannelImportCard(): JSX.Element {
  const userId = useUserId();
  const query = useImportQuery();
  const discover = useDiscoverMutation();
  const importChannels = useRunImportMutation();
  const [search, setSearch] = createSignal('');
  const [showArchived, setShowArchived] = createSignal(false);
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  // Guard resource reads so polling never suspends the surrounding settings page.
  const state = () => (query.isSuccess ? query.data : EMPTY_STATE);
  const run = () => state().runs.find((run) => run.source === 'slack');
  const rows = createMemo(() => buildRows(state(), userId()));
  const visible = createMemo(() =>
    filterRows(rows(), {
      search: search(),
      showArchived: showArchived(),
    })
  );
  const visibleIds = () => selectableIds(visible());
  // Progress updates can make a previously selected row no longer importable.
  const importIds = () =>
    selectableIds(rows()).filter((id) => selected().has(id));
  const allSelected = () =>
    visibleIds().length > 0 && visibleIds().every((id) => selected().has(id));
  const someSelected = () => visibleIds().some((id) => selected().has(id));
  const discovering = () => discover.isPending || run()?.status === 'running';
  let selectAll: HTMLInputElement | undefined;
  // Indeterminate is a DOM property, not an HTML checkbox attribute.
  createEffect(() => {
    if (selectAll) selectAll.indeterminate = someSelected() && !allSelected();
  });

  function select(ids: string[], checked: boolean): void {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function findChannels(): void {
    discover.mutate('slack', {
      onError: () => toast.failure('Failed to find Slack channels'),
    });
  }

  function startImport(): void {
    const ids = importIds();
    if (!ids.length) return;
    importChannels.mutate(
      { importIds: ids, discardIds: [] },
      {
        onSuccess: () => setSelected(new Set<string>()),
        onError: () => toast.failure('Failed to import Slack channels'),
      }
    );
  }

  return (
    <SettingsSection
      title="Import channels"
      description="Recreate Slack channels in Macro with their name and the members who are on your team. Messages are not imported."
    >
      <SettingsCard>
        <div class="flex flex-col gap-4 p-5 touch:p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p role="status" class="text-sm text-ink-muted">
              {runLabel(run())}
            </p>
            <Button
              variant="accent"
              size="sm"
              disabled={
                discovering() || !query.isSuccess || importChannels.isPending
              }
              onClick={findChannels}
            >
              <Show when={discovering()}>
                <SpinnerIcon class="size-4 animate-spin" aria-hidden="true" />
              </Show>
              {run() || rows().length > 0 ? 'Refresh' : 'Find channels'}
            </Button>
          </div>
          <Show when={query.isError}>
            <div role="alert" class="text-sm text-failure">
              Could not load Slack import progress.
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Retry
              </Button>
            </div>
          </Show>
          <Show when={run()?.status === 'failed'}>
            <div role="alert" class="text-sm text-failure break-words">
              {run()?.error || 'Slack channel discovery failed.'}
              <Button
                variant="ghost"
                size="sm"
                disabled={discovering()}
                onClick={findChannels}
              >
                Retry
              </Button>
            </div>
          </Show>
          <label class="flex flex-col gap-1 text-sm">
            Search channels
            <input
              type="search"
              class="rounded border border-edge-muted bg-input p-2 text-ink"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
          </label>
          <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showArchived()}
                onChange={(event) =>
                  setShowArchived(event.currentTarget.checked)
                }
              />
              Show archived
            </label>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allSelected()}
                ref={selectAll}
                disabled={!visibleIds().length || importChannels.isPending}
                onChange={(event) =>
                  select(visibleIds(), event.currentTarget.checked)
                }
              />
              Select all visible
            </label>
          </div>
          <p class="text-sm text-ink-muted">
            {importIds().length} selected. Filtering does not clear selections.
          </p>
          <Show when={rows().length > 0}>
            <ul
              aria-label="Slack channels"
              class="max-h-72 overflow-y-auto rounded border border-edge-muted px-3 divide-y divide-edge-muted"
            >
              <For
                each={visible()}
                fallback={
                  <li class="py-3 text-sm text-ink-muted">
                    No matching channels.
                  </li>
                }
              >
                {(row) => (
                  <ChannelRow
                    row={row}
                    selected={selected().has(row.id)}
                    disabled={importChannels.isPending}
                    onSelect={(checked) => select([row.id], checked)}
                  />
                )}
              </For>
            </ul>
          </Show>
          <Show when={run()?.status === 'ready' && rows().length === 0}>
            <p class="text-sm text-ink-muted">No public channels found</p>
          </Show>
          <div class="flex flex-col items-start gap-3">
            <Button
              variant="accent"
              size="sm"
              disabled={!importIds().length || importChannels.isPending}
              onClick={startImport}
            >
              <Show when={importChannels.isPending}>
                <SpinnerIcon class="size-4 animate-spin" aria-hidden="true" />
              </Show>
              Import {importIds().length} channels
            </Button>
            <p class="text-xs text-ink-muted">
              Private channels and direct messages are not imported yet.
            </p>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
