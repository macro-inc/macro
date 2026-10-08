import '@app/index.css';
import { Button } from '@ui';
import { okAsync } from 'neverthrow';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { DatabaseColumnHeader } from '../../database/components/database-column-header';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { PipelineDialog } from '../components/pipeline-dialog';
import { PipelineSidebar } from '../components/pipeline-sidebar';
import type { PipelinesSource } from '../context/pipelines';
import type { Pipeline } from '../core/pipeline';
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
function Fixture() {
  const [pipelines, setPipelines] = createSignal<Pipeline[]>([]);
  const [selected, setSelected] = createSignal<string>();
  const [creating, setCreating] = createSignal(false);
  const [failNext, setFailNext] = createSignal(false);
  const [calls, setCalls] = createSignal(0);
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
