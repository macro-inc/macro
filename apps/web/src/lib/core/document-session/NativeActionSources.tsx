import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableDatabases } from '@core/constant/featureFlags';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { fuzzyFilter } from '@core/util/fuzzy';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { ACTIONS } from '../component/LexicalMarkdown/plugins/actions/actions';
import {
  availableActions,
  mergeActions,
} from '../component/LexicalMarkdown/plugins/actions/available-actions';
import type { Action } from '../component/LexicalMarkdown/plugins/actions/types';
import type {
  Block,
  MenuChoice,
  MenuEvent,
  MenuQuery,
} from './generated/native-bridge';
import type { NativeAndroidSurface } from './native-android';

// These source actions dispatch the existing shared block-transform command.
// Pickers/creation workflows need their own typed adapters before admission.
const blockActions: ReadonlyMap<string, Block> = new Map([
  ['paragraph', 'paragraph'],
  ['heading1', 'heading1'],
  ['heading2', 'heading2'],
  ['heading3', 'heading3'],
  ['quote', 'quote'],
  ['code', 'code'],
  ['list-bullet', 'bullet'],
  ['list-number', 'number'],
  ['list-check', 'check'],
]);

/** Native rows reuse the actual action catalog, availability filter and fuzzy ranking. */
export function NativeActionSources(props: {
  surface: Pick<NativeAndroidSurface, 'menuRows' | 'menuCommit'>;
  event: Accessor<MenuEvent | undefined>;
  additionalActions?: readonly Action[];
  ignoreActionIds?: readonly string[];
  /** Additional/overridden source actions require an explicit typed native choice. */
  choices?: ReadonlyMap<string, MenuChoice>;
  onError(error: unknown): void;
}) {
  const [query, setQuery] = createSignal<MenuQuery>();
  const term = debouncedDependent(() => query()?.term.toLowerCase() ?? '', 60);
  const databases = useFeatureFlag(enableDatabases);
  const merged = mergeActions(ACTIONS, props.additionalActions);
  let owner = props.surface;
  let disposed = false;
  let selected = false;

  function choice(action: Action): MenuChoice | undefined {
    const explicit = props.choices?.get(action.id);
    if (explicit) return explicit;
    // An override can change an ID's behavior; never substitute the old command.
    if (!ACTIONS.includes(action)) return;
    const block = blockActions.get(action.id);
    return block ? { kind: 'block', block } : undefined;
  }

  const items = createMemo(() => {
    const active = query();
    if (!active || term() !== active.term.toLowerCase()) return [];
    const valid = availableActions(merged, {
      databasesEnabled: databases().enabled,
      ignoreActionIds: props.ignoreActionIds,
      hasNodes: (dependencies) =>
        dependencies.every((node) => active.nodeTypes.includes(node.getType())),
    }).filter((action) => choice(action) !== undefined);
    return fuzzyFilter(term(), valid, (item) =>
      [item.name, ...item.keywords].join(' ')
    );
  });

  function current(expected: MenuQuery, surface: typeof props.surface) {
    const active = query()?.identity;
    return (
      !disposed &&
      owner === surface &&
      props.surface === surface &&
      active?.mountGeneration === expected.identity.mountGeneration &&
      active.modelGeneration === expected.identity.modelGeneration &&
      active.invocation === expected.identity.invocation &&
      active.queryGeneration === expected.identity.queryGeneration
    );
  }

  function closeOwned() {
    const active = query();
    if (active)
      fireAndForget(
        owner.menuRows({ identity: active.identity, rows: [], buckets: [] }),
        'native-actions.close'
      );
  }

  function report(
    task: Promise<void>,
    active: MenuQuery,
    surface: typeof props.surface,
    rowId?: string
  ) {
    async function finish() {
      try {
        await task;
      } catch (error) {
        if (!current(active, surface)) return;
        try {
          if (rowId)
            await surface.menuRows({
              identity: active.identity,
              rows: [],
              buckets: [],
              rejectedRowId: rowId,
            });
        } finally {
          if (current(active, surface)) props.onError(error);
        }
      }
    }
    fireAndForget(finish(), 'native-actions.provider');
  }

  function synchronizeOwner() {
    if (owner === props.surface) return;
    closeOwned();
    owner = props.surface;
    setQuery(undefined);
    selected = false;
  }

  createEffect(
    on(props.event, (event) => {
      synchronizeOwner();
      if (
        !event ||
        event.query.kind !== 'action' ||
        event.action === 'closed'
      ) {
        setQuery(undefined);
        selected = false;
        return;
      }
      const surface = props.surface;
      if (event.action === 'query') {
        if (current(event.query, surface)) return;
        owner = surface;
        selected = false;
        setQuery(event.query);
        return;
      }
      const active = query();
      if (
        !active ||
        !current(event.query, surface) ||
        selected ||
        event.action !== 'select'
      )
        return;
      const item = items().find((item) => item.id === event.rowId);
      const answer = item ? choice(item) : undefined;
      if (!item || !answer) {
        report(
          surface.menuRows({
            identity: active.identity,
            rows: [],
            buckets: [],
            rejectedRowId: event.rowId,
          }),
          active,
          surface
        );
        return;
      }
      selected = true;
      report(
        surface.menuCommit({
          identity: active.identity,
          rowId: item.id,
          choice: answer,
        }),
        active,
        surface,
        item.id
      );
    })
  );

  createEffect(() => {
    const active = query();
    if (!active || selected || owner !== props.surface) return;
    const rows = items();
    report(
      props.surface.menuRows({
        identity: active.identity,
        rows: rows.map((item) => ({
          id: item.id,
          bucketId: 'actions',
          label: item.name,
          detail: item.shortcut,
        })),
        buckets: [
          {
            id: 'actions',
            label: 'Actions',
            loadedCount: rows.length,
            hasMore: false,
            isLoading: term() !== active.term.toLowerCase(),
            isLoadingMore: false,
          },
        ],
      }),
      active,
      props.surface
    );
  });

  createEffect(on(() => props.surface, synchronizeOwner, { defer: true }));
  onCleanup(() => {
    disposed = true;
    closeOwned();
  });
  return null;
}
