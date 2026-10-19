import '@app/index.css';
import { Button } from '@ui';
import { okAsync } from 'neverthrow';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { DatabaseColumnHeader } from '../../database/components/database-column-header';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { PipelineDialog } from '../components/pipeline-dialog';
import { PipelineSidebar } from '../components/pipeline-sidebar';
import type { PipelinesSource, PipelineTransfer } from '../context/pipelines';
import type { Pipeline } from '../core/pipeline';
import type { PipelineCsvRow } from '../core/pipeline-csv';
import { PipelineView } from '../views/pipeline';

// Real creation, navigation and column-header controls. Persistence is
// local; the Rust integration suite exercises the same contract against Postgres.
function Editor(props: { pipeline: Pipeline }) {
  const [columns, setColumns] = createSignal<DatabaseViewColumn[]>([
    {
      id: 'primary',
      name: props.pipeline.recordType === 'company' ? 'Company' : 'Contact',
      dataType: 'ENTITY',
      specificEntityType:
        props.pipeline.recordType === 'company' ? 'COMPANY' : 'CONTACT',
      primary: true,
      protections: ['delete', 'change_type'],
      nullable: false,
      writable: true,
      isMultiSelect: false,
      options: [],
    },
    {
      id: 'stage',
      name: 'Stage',
      dataType: 'STRING',
      writable: true,
      isMultiSelect: false,
      options: [],
    },
  ]);
  return (
    <div class="flex border-b border-edge-muted" role="row">
      <For each={columns()}>
        {(column) => (
          <div class="w-64">
            <DatabaseColumnHeader
              column={column}
              canRename
              onSort={() => {}}
              onChangeType={() => okAsync(undefined)}
              onDelete={(id) => {
                setColumns((before) =>
                  before.filter((column) => column.id !== id)
                );
                return okAsync(undefined);
              }}
              onRename={(id, name) => {
                setColumns((before) =>
                  before.map((column) =>
                    column.id === id ? { ...column, name } : column
                  )
                );
                return okAsync(undefined);
              }}
            />
          </div>
        )}
      </For>
    </div>
  );
}
const transferColumns: DatabaseViewColumn[] = [
  {
    id: 'primary',
    name: 'Company',
    dataType: 'ENTITY',
    specificEntityType: 'COMPANY',
    writable: true,
    isMultiSelect: false,
    options: [],
  },
  {
    id: 'stage',
    name: 'Stage',
    dataType: 'SELECT_STRING',
    writable: true,
    isMultiSelect: false,
    options: [{ id: 'lead', label: 'Lead', color: null }],
  },
];

/** In-memory entries: each pipeline starts with Acme, and records are named by domain. */
function createTransfer(onInserted: (count: number) => void): PipelineTransfer {
  const rows: PipelineCsvRow[] = [
    { cells: { primary: 'acme.com-id', stage: 'Lead' } },
  ];
  return {
    readTable: async () => ({ columns: transferColumns, rows: [...rows] }),
    describeRecords: async (ids) =>
      new Map(
        ids.map((id) => [
          id,
          { name: id.replace(/-id$/, ''), key: id.replace(/-id$/, '') },
        ])
      ),
    resolveRecords: async (records) =>
      new Map(records.map((record) => [record.key, `${record.key}-id`])),
    insertRows: async (added) => {
      for (const cells of added) {
        const [record] = cells;
        if (record?.value.type === 'entities')
          rows.push({ cells: { primary: record.value.value[0].entityId } });
      }
      onInserted(rows.length);
    },
    refresh: async () => {},
  };
}

async function downloadCsv(content: string, filename: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  link.download = filename;
  link.click();
  return { saved: true };
}

function Fixture() {
  const [pipelines, setPipelines] = createSignal<Pipeline[]>([]);
  const [selected, setSelected] = createSignal<string>();
  const [creating, setCreating] = createSignal(false);
  const [failNext, setFailNext] = createSignal(false);
  const [calls, setCalls] = createSignal(0);
  const [entries, setEntries] = createSignal(1);
  const active = () =>
    pipelines().find((pipeline) => pipeline.id === selected());
  const source: PipelinesSource = {
    pipelines,
    loading: () => false,
    error: () => false,
    refresh: async () => {},
    create: async (input) => {
      setCalls((count) => count + 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (failNext()) {
        setFailNext(false);
        throw new Error('Test request failed');
      }
      const pipeline: Pipeline = {
        ...input,
        id: crypto.randomUUID(),
        databaseId: crypto.randomUUID(),
        tableId: crypto.randomUUID(),
        primaryColumnId: 'primary',
        teamId: 'team',
        userId: 'macro|owner@example.com',
        grant: 'owner',
        createdAt: new Date().toISOString(),
        trashedAt: null,
      };
      setPipelines((before) => [...before, pipeline]);
      return pipeline;
    },
    rename: async (id, name) => {
      setPipelines((before) =>
        before.map((p) => (p.id === id ? { ...p, name } : p))
      );
    },
    trash: async (id) => {
      setPipelines((before) => before.filter((p) => p.id !== id));
    },
  };
  return (
    <main class="flex h-screen flex-col bg-panel text-ink">
      <div class="flex gap-3 p-2">
        <Button onClick={() => setFailNext(true)}>Fail next create</Button>
        <output aria-label="Create requests">{calls()}</output>
        <output aria-label="Pipeline entries">{entries()}</output>
      </div>
      <div class="flex min-h-0 flex-1">
        <aside class="w-60 shrink-0 border-r border-edge-muted">
          <PipelineSidebar
            pipelines={pipelines()}
            activeId={selected()}
            loading={false}
            error={false}
            canCreate
            onCreate={() => setCreating(true)}
            onSelect={setSelected}
            onRetry={() => {}}
          />
        </aside>
        <div class="min-w-0 flex-1">
          <Show when={selected()} keyed>
            {(_id) => (
              <Show when={active()}>
                {(pipeline) => (
                  <PipelineView
                    pipeline={pipeline()}
                    source={source}
                    Editor={Editor}
                    Sharing={() => null}
                    onCopyLink={() => {}}
                    onTrashed={() => setSelected(undefined)}
                    transfer={{
                      source: createTransfer(setEntries),
                      downloadCsv,
                    }}
                  />
                )}
              </Show>
            )}
          </Show>
        </div>
      </div>
      <Show when={creating()}>
        <PipelineDialog
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            const pipeline = await source.create(input);
            setSelected(pipeline.id);
          }}
        />
      </Show>
    </main>
  );
}
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
