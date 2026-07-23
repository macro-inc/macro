import {
  type ImportEntity,
  type ImportRun,
  type ImportSource,
  useImportQuery,
  useRetryGatherMutation,
} from '@queries/import';
import { createMemo, For, Show } from 'solid-js';
import { SourceImportCard } from './SourceImportCard';
import {
  type SkippedSources,
  SOURCE_SECTIONS,
  type SourceSection,
} from './selection';

/** The `(gather run, ledger rows)` slice one source's card renders from. */
interface SourceSlice {
  run?: ImportRun;
  entities: ImportEntity[];
}

/**
 * The import side of `/setup`: one card per connected source, rendered from
 * the import aggregate. Pills stream in live (gateway pushes + polling);
 * whether a section imports is a single toggle per card. Skip state lives
 * in the page (SetupPage), so the footer's "Continue to Macro" imports
 * exactly the sections still toggled on.
 */
export function ImportPanel(props: {
  skipped: SkippedSources;
  onToggleSource: (source: ImportSource, skipped: boolean) => void;
}) {
  const importQuery = useImportQuery();
  const retryGather = useRetryGatherMutation();

  const bySource = createMemo(() => {
    const state = importQuery.data;
    const map = new Map<ImportSource, SourceSlice>();
    for (const { source } of SOURCE_SECTIONS) {
      map.set(source, {
        run: state?.runs.find((run) => run.source === source),
        entities: (state?.entities ?? []).filter(
          (entity) => entity.source === source && entity.status !== 'discarded'
        ),
      });
    }
    return map;
  });

  const sliceFor = (definition: SourceSection): SourceSlice =>
    bySource().get(definition.source) ?? { entities: [] };

  const isVisible = (slice: SourceSlice) =>
    slice.run !== undefined || slice.entities.length > 0;

  const anyVisible = createMemo(() =>
    SOURCE_SECTIONS.some((definition) => isVisible(sliceFor(definition)))
  );

  return (
    <div class="flex flex-1 flex-col gap-7 overflow-y-auto p-8">
      <header>
        <h2 class="text-lg font-semibold">Workspace setup</h2>
      </header>

      <Show
        when={anyVisible()}
        fallback={
          <p class="text-sm text-ink-extra-muted">
            Connect a tool on the left to see what you can bring over.
          </p>
        }
      >
        <div class="flex flex-col gap-4">
          {/* Iterate the static definitions (stable row identity across
              refetches); visibility is decided per row. */}
          <For each={SOURCE_SECTIONS}>
            {(definition) => (
              <Show when={isVisible(sliceFor(definition))}>
                <SourceImportCard
                  definition={definition}
                  run={sliceFor(definition).run}
                  entities={sliceFor(definition).entities}
                  skipped={props.skipped[definition.source] === true}
                  onToggleSkipped={(skipped) =>
                    props.onToggleSource(definition.source, skipped)
                  }
                  onRetryGather={() => retryGather.mutate(definition.source)}
                />
              </Show>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
