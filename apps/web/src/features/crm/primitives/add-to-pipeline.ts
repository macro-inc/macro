import { t } from '@app/lib/i18n';
import { deepEqual } from '@core/util/compareUtils';
import {
  type Accessor,
  createMemo,
  createSignal,
  getOwner,
  runWithOwner,
} from 'solid-js';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';
import type { RecordCreation } from '../../database/primitives/record-actions';
import type {
  AddToPipelineRecord,
  AddToPipelineSource,
  PipelineRowAdded,
} from '../context/pipelines';
import {
  type PipelineChoice,
  pipelineChoices,
  stageAddition,
  stageColumn,
} from '../core/add-to-pipeline';
import type { TrackedPipeline } from '../core/pipeline';
import type { PipelineEntryRecord } from '../core/pipeline-entry';
import type { StageRequirement } from '../core/stage-requirements';

/** What the Add to pipeline menu shows instead of, or as, its pipelines. */
export type AddToPipelineMenuState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'ready'; choices: PipelineChoice[] };

/** The add form, opened when a stage needs fields or the flow always asks. */
export type AddToPipelineForm = {
  pipeline: TrackedPipeline;
  /** The chosen stage, or undefined for the pipeline's first. */
  stage?: string;
};

export type AddToPipelineDependencies = {
  createSource(record: Accessor<PipelineEntryRecord>): AddToPipelineSource;
  feedback: { success(message: string): void; failure(message: string): void };
};

/**
 * A record page's Add to pipeline menu. Nothing is read until the menu first
 * opens; from then on the reads stay for the page's life, so closing and
 * reopening the menu, and the Pipelines card's refresh after an add, cost no
 * new request.
 */
export function createAddToPipeline(
  deps: AddToPipelineDependencies,
  record: Accessor<AddToPipelineRecord>
) {
  const owner = getOwner();
  const [source, setSource] = createSignal<AddToPipelineSource>();
  const [form, setForm] = createSignal<AddToPipelineForm>();
  const [adding, setAdding] = createSignal(false);
  // Pipelines this page added the record to; a refetch that reads a lagging
  // replica must not offer a contact the same pipeline again.
  const [added, setAdded] = createSignal<string[]>([]);
  const entryRecord = createMemo<PipelineEntryRecord>(
    () => ({ type: record().type, id: record().id }),
    { type: record().type, id: record().id },
    { equals: (a, b) => a.type === b.type && a.id === b.id }
  );

  /** Starts the reads; called when the menu first opens. */
  function load() {
    if (source()) return;
    setSource(runWithOwner(owner, () => deps.createSource(entryRecord)));
  }

  // An unchanged choice keeps its object, so a refetch under the open menu
  // does not remount its row and close the stages it shows.
  let previous: PipelineChoice[] = [];
  const state = createMemo((): AddToPipelineMenuState => {
    const current = source();
    if (!current || current.loading()) return { kind: 'loading' };
    if (current.error()) return { kind: 'error' };
    const choices = pipelineChoices(
      current.pipelines(),
      record().type,
      current.entries(),
      added()
    ).map(
      (choice) => previous.find((kept) => deepEqual(kept, choice)) ?? choice
    );
    previous = choices;
    return choices.length ? { kind: 'ready', choices } : { kind: 'empty' };
  });

  async function addRow(
    pipeline: TrackedPipeline,
    columns: readonly DatabaseViewColumn[],
    creation: RecordCreation
  ): Promise<boolean> {
    const current = source();
    if (!current) return false;
    setAdding(true);
    let outcome: PipelineRowAdded;
    try {
      outcome = await current.addRow(pipeline, columns, creation);
    } finally {
      setAdding(false);
    }
    if (outcome.kind !== 'failed')
      setAdded((ids) =>
        ids.includes(pipeline.id) ? ids : [...ids, pipeline.id]
      );
    const stage = stageLabel(columns, creation.values);
    if (outcome.kind === 'failed') {
      deps.feedback.failure(outcome.message);
      return false;
    }
    if (outcome.kind === 'uncertain') {
      // Retrying could add the row twice; the Pipelines card shows it if it landed.
      deps.feedback.failure(
        t('crm.addToPipelineUncertain', { pipeline: pipeline.name })
      );
      return true;
    }
    deps.feedback.success(
      stage
        ? t('crm.addedToPipelineStage', { pipeline: pipeline.name, stage })
        : t('crm.addedToPipeline', { pipeline: pipeline.name })
    );
    return true;
  }

  /** Adds the record at `stage` at once, or opens the form when that stage requires fields. */
  async function chooseStage(
    pipeline: TrackedPipeline,
    columns: readonly DatabaseViewColumn[],
    rules: readonly StageRequirement[],
    stage: string | undefined
  ) {
    if (adding()) return;
    const addition = stageAddition(columns, rules, record().id, stage);
    if (addition.kind === 'form') {
      setForm({ pipeline, stage });
      return;
    }
    await addRow(pipeline, columns, {
      values: addition.values,
      open: false,
      intentId: `pipeline-record:${crypto.randomUUID()}`,
    });
  }

  return {
    record,
    load,
    state,
    source,
    adding,
    form,
    openForm: (pipeline: TrackedPipeline, stage?: string) =>
      setForm({ pipeline, stage }),
    closeForm: () => setForm(undefined),
    /** The form could not read its pipeline; says so and closes it. */
    failForm(pipeline: TrackedPipeline) {
      deps.feedback.failure(
        t('crm.addToPipelineFormFailed', { pipeline: pipeline.name })
      );
      setForm(undefined);
    },
    chooseStage,
    addRow,
  };
}

export type AddToPipelineController = ReturnType<typeof createAddToPipeline>;

/** The stage `values` puts a new row at, for the confirmation. */
function stageLabel(
  columns: readonly DatabaseViewColumn[],
  values: Record<string, DatabaseCellValue> | undefined
): string | undefined {
  const column = stageColumn(columns);
  const value = column && values?.[column.id];
  return typeof value === 'string' && value ? value : undefined;
}

/** The form's starting values: the chosen stage, else the pipeline's first. */
export function formStage(
  columns: readonly DatabaseViewColumn[],
  stage: string | undefined
): Record<string, DatabaseCellValue> {
  const column = stageColumn(columns);
  if (!column) return {};
  const label = stage ?? column.options[0]?.label;
  return label === undefined ? {} : { [column.id]: label };
}
