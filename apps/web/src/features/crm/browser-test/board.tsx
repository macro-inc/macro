import '@app/index.css';
import { loadDatabaseSqlWasm } from '@core/database-sql/wasm-module';
import BuildingIcon from '@icon/system/regular/buildings.svg';
import UserIcon from '@icon/system/regular/user.svg';
import { queryReadyGate } from '@queries/gate';
import type { CardPosition } from '@service-storage/generated/schemas/cardPosition';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { DatabaseMentionLabel } from '../../database/components/database-mention-label';
import type {
  DatabaseRowsSnapshot,
  DatabaseRowsSource,
} from '../../database/context/table-source';
import { boardInput } from '../../database/core/board-input';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { optimisticRows } from '../../database/core/table';
import type { DatabaseViewState } from '../../database/core/view-state';
import { DatabaseRecordsView } from '../../database/views/database-records-view';
import { applyTheme } from '../../theme/utils/themeUtils';
import { crmKeys } from '../queries/keys';
import { usePipelinePositionsQuery } from '../queries/pipeline-views';

applyTheme(
  new URLSearchParams(location.search).get('theme') === 'dark'
    ? 'Macro Dark'
    : 'Macro Light'
);
document.documentElement.dataset.touchDevice = String(
  matchMedia('(pointer: coarse)').matches
);

const columns: DatabaseViewColumn[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Company',
    dataType: 'ENTITY',
    specificEntityType: 'COMPANY',
    primary: true,
    nullable: false,
    writable: true,
    isMultiSelect: false,
    options: [],
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Stage',
    dataType: 'SELECT_STRING',
    writable: true,
    isMultiSelect: false,
    options: [
      {
        id: '00000000-0000-0000-0000-000000000006',
        label: 'New lead',
        color: 'blue',
      },
      {
        id: '00000000-0000-0000-0000-000000000007',
        label: 'Demo scheduled',
        color: 'orange',
      },
      {
        id: '00000000-0000-0000-0000-000000000008',
        label: 'Won',
        color: 'green',
      },
    ],
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    name: 'Owner',
    dataType: 'ENTITY',
    specificEntityType: 'USER',
    writable: true,
    isMultiSelect: false,
    options: [],
  },
  {
    id: '00000000-0000-0000-0000-000000000004',
    name: 'Revenue',
    dataType: 'NUMBER',
    writable: true,
    isMultiSelect: false,
    options: [],
  },
  {
    id: '00000000-0000-0000-0000-000000000005',
    name: 'Next step',
    dataType: 'STRING',
    writable: true,
    isMultiSelect: false,
    options: [],
  },
];
const names: Record<string, string> = {
  acme: 'Acme International Manufacturing',
  borealis: 'Borealis',
  northstar: 'Northstar',
  'macro|owner@example.com': 'Alex Morgan',
};
const table = {
  id: '00000000-0000-0000-0000-000000000009',
  databaseId: '00000000-0000-0000-0000-000000000010',
  name: 'Sales',
  columns,
  version: 1,
};
const view: DatabaseViewState = {
  query: { filter: null },
  layout: {
    kind: 'board',
    groupBy: '00000000-0000-0000-0000-000000000002',
    title: '00000000-0000-0000-0000-000000000001',
    cardFields: [
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000005',
    ],
    lanes: [],
    hideEmptyLanes: false,
  },
};
const engine = await loadDatabaseSqlWasm();
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function BoardFixture() {
  const switching = new URLSearchParams(location.search).get('switch');
  const [selectedViewId, setSelectedViewId] = createSignal('board');
  const [finishMove, setFinishMove] = createSignal<() => void>();
  const positionStorage = (id: string) =>
    id === 'board' ? 'crm-board-positions' : `crm-board-positions:${id}`;
  const savedRows = sessionStorage.getItem('crm-board-rows');
  const [snapshot, setSnapshot] = createSignal<DatabaseRowsSnapshot>(
    savedRows
      ? JSON.parse(savedRows)
      : {
          rows: [
            {
              rowId: '00000000-0000-0000-0000-000000000011',
              cells: {
                '00000000-0000-0000-0000-000000000001': 'acme',
                '00000000-0000-0000-0000-000000000002': 'New lead',
                '00000000-0000-0000-0000-000000000003':
                  'macro|owner@example.com',
                '00000000-0000-0000-0000-000000000004': 14400,
                '00000000-0000-0000-0000-000000000005':
                  'Review the proposal with the finance and operations teams before the next call.',
              },
            },
            {
              rowId: '00000000-0000-0000-0000-000000000012',
              cells: {
                '00000000-0000-0000-0000-000000000001': 'borealis',
                '00000000-0000-0000-0000-000000000002': 'New lead',
                '00000000-0000-0000-0000-000000000003':
                  'macro|owner@example.com',
                '00000000-0000-0000-0000-000000000004': 0,
                '00000000-0000-0000-0000-000000000005': null,
              },
            },
            {
              rowId: '00000000-0000-0000-0000-000000000013',
              cells: {
                '00000000-0000-0000-0000-000000000001': 'northstar',
                '00000000-0000-0000-0000-000000000002': 'Demo scheduled',
                '00000000-0000-0000-0000-000000000003': null,
                '00000000-0000-0000-0000-000000000004': null,
                '00000000-0000-0000-0000-000000000005':
                  'Send the product walkthrough.',
              },
            },
          ],
          retained: [],
          version: 1,
        }
  );
  const [opened, setOpened] = createSignal('');
  const [composing, setComposing] = createSignal('');
  const positions = usePipelinePositionsQuery(
    {
      client,
      storage: {
        getCrmPipelineViewPositions: async (_pipeline, viewId) => {
          const saved = sessionStorage.getItem(positionStorage(viewId));
          const positions: CardPosition[] = saved ? JSON.parse(saved) : [];
          return okAsync(positions);
        },
      },
    },
    'sales',
    selectedViewId
  );
  const source: DatabaseRowsSource = {
    columns: () => columns,
    snapshot,
    read: () => ({
      ...boardInput(table, snapshot().rows, view),
      version: snapshot().version,
    }),
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    refresh: () => okAsync(undefined),
    retain: () => {},
    addOption: () => okAsync(undefined),
    write: (mutation) => {
      // This fixture tests delegation to the host composer, not record creation.
      if (mutation.kind === 'create')
        return errAsync({
          kind: 'ops',
          error: {
            code: 'INVALID_OP',
            message: 'Create pipeline records through the host composer.',
            refusal: null,
          },
        });
      const next = {
        ...snapshot(),
        rows: optimisticRows(snapshot().rows, [mutation]),
        version: (snapshot().version ?? 0) + 1,
      };
      setSnapshot(next);
      sessionStorage.setItem('crm-board-rows', JSON.stringify(next));
      return okAsync({ version: next.version, insertedRowIds: [] });
    },
  };
  return (
    <main class="flex h-screen flex-col bg-page text-ink">
      <div class="flex items-center gap-3 px-5 py-3 border-b border-edge-muted">
        <h1 class="text-sm font-semibold">Sales pipeline</h1>
        <Show when={switching}>
          <button onClick={() => setSelectedViewId('board')}>Board A</button>
          <button onClick={() => setSelectedViewId('other-board')}>
            Board B
          </button>
          <button disabled={!finishMove()} onClick={() => finishMove()?.()}>
            Finish move
          </button>
        </Show>
        <output aria-label="Opened record">{opened()}</output>
        <output aria-label="New record stage">{composing()}</output>
      </div>
      <DatabaseRecordsView
        name="Sales"
        source={source}
        canEdit
        view={view}
        stored
        onComposeRecord={(values) =>
          setComposing(String(values['00000000-0000-0000-0000-000000000002']))
        }
        onOpenTitleMention={(id) => setOpened(names[id])}
        renderMentionValue={(id, entityType) => (
          <DatabaseMentionLabel
            name={names[id] ?? id}
            entityType={entityType}
            icon={
              entityType === 'USER' ? (
                <UserIcon class="size-4" />
              ) : (
                <BuildingIcon class="size-4" />
              )
            }
          />
        )}
        boardPositions={{
          get viewId() {
            return selectedViewId();
          },
          state: () =>
            queryReadyGate(positions)
              ? { kind: 'ready', positions: positions.data }
              : { kind: 'loading' },
          move: (move) => {
            const origin = selectedViewId();
            const current: CardPosition[] = queryReadyGate(positions)
              ? positions.data
              : [];
            const commit = () => {
              const input = boardInput(table, snapshot().rows, view);
              const board = engine.board(
                input.catalog,
                input.view,
                input.outcome,
                current
              );
              const lane = board.lanes.find(
                (lane) => JSON.stringify(lane.key) === JSON.stringify(move.lane)
              );
              const rows = (lane?.cards ?? []).filter((id) => id !== move.row);
              rows.splice(
                move.after ? rows.indexOf(move.after) : rows.length,
                0,
                move.row
              );
              let key: string | null = null;
              const saved = rows.map((row) => {
                key = engine.keyBetween(key, null);
                return { row, lane: move.lane, position: key };
              });
              const next = [
                ...current.filter((position) => !rows.includes(position.row)),
                ...saved,
              ];
              sessionStorage.setItem(
                positionStorage(origin),
                JSON.stringify(next)
              );
              const label =
                columns[1].options.find(
                  (option) =>
                    move.lane.kind === 'option' && option.id === move.lane.id
                )?.label ?? null;
              const updated = {
                ...snapshot(),
                rows: snapshot().rows.map((row) =>
                  row.rowId === move.row
                    ? {
                        ...row,
                        cells: {
                          ...row.cells,
                          '00000000-0000-0000-0000-000000000002': label,
                        },
                      }
                    : row
                ),
                version: (snapshot().version ?? 0) + 1,
              };
              setSnapshot(updated);
              sessionStorage.setItem('crm-board-rows', JSON.stringify(updated));
              client.setQueryData(
                crmKeys.pipelinePositions('sales', origin).queryKey,
                next
              );
              return { positions: saved, tableVersion: updated.version };
            };
            if (!switching) return okAsync(commit());
            const pending = Promise.withResolvers<void>();
            setFinishMove(() => () => {
              setFinishMove(undefined);
              pending.resolve();
            });
            return ResultAsync.fromSafePromise(pending.promise).andThen(() =>
              switching === 'refusal'
                ? errAsync({
                    kind: 'ops' as const,
                    error: {
                      code: 'INVALID_OP' as const,
                      message: 'Refused',
                      refusal: null,
                    },
                  })
                : okAsync(commit())
            );
          },
        }}
      />
    </main>
  );
}
render(
  () => (
    <QueryClientProvider client={client}>
      <BoardFixture />
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);
