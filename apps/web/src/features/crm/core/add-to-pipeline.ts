import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';
import { titleColumn } from '../../database/core/table';
import {
  isTrackedPipeline,
  type Pipeline,
  type PipelineRecordType,
  type TrackedPipeline,
} from './pipeline';
import type { PipelineEntry } from './pipeline-entry';
import {
  missingStageFields,
  requiredStageFields,
  type StageRequirement,
} from './stage-requirements';

/**
 * What choosing a pipeline from a record's page asks for: `stage` lists the
 * pipeline's stages and adds the row at the one chosen, opening the add form
 * only when that stage requires fields; `form` always opens the add form at
 * the first stage.
 */
export const ADD_TO_PIPELINE_FLOW: 'stage' | 'form' = 'stage';

/**
 * Whether a record can be added again to a pipeline it is already in. A
 * company pipeline's rows are deals, and a company can have several; a contact
 * is in a contact pipeline once.
 */
export const ADDS_AGAIN: Record<PipelineRecordType, boolean> = {
  company: true,
  contact: false,
};

/** Why a pipeline cannot take the record, or `available` when it can. */
export type PipelineChoiceState = 'available' | 'view-only' | 'already-in';

/** A pipeline the record's page offers, with the record's rows in it. */
export type PipelineChoice = {
  pipeline: TrackedPipeline;
  /** The stage of each of the record's rows in this pipeline; empty when it has none. */
  stages: string[];
  inPipeline: boolean;
  state: PipelineChoiceState;
};

/**
 * The single-select column a pipeline's rows move through: the one named
 * Stage, else the first single-select the pipeline owns (not Outcome or
 * currency, whose options are fixed).
 */
export function stageColumn(
  columns: readonly DatabaseViewColumn[]
): DatabaseViewColumn | undefined {
  const stages = columns.filter(
    (column) =>
      column.dataType === 'SELECT_STRING' &&
      !column.isMultiSelect &&
      !column.fixedOptions
  );
  return stages.find((column) => column.name === 'Stage') ?? stages[0];
}

/**
 * The pipelines a record of `recordType` can go in, by name, marked with the
 * rows it already has. `added` names pipelines it was just added to, which a
 * lagging read of `entries` may not show yet.
 */
export function pipelineChoices(
  pipelines: readonly Pipeline[],
  recordType: PipelineRecordType,
  entries: readonly PipelineEntry[],
  added: readonly string[] = []
): PipelineChoice[] {
  return pipelines
    .filter(
      (pipeline): pipeline is TrackedPipeline =>
        isTrackedPipeline(pipeline) &&
        pipeline.recordType === recordType &&
        pipeline.trashedAt === null
    )
    .map((pipeline): PipelineChoice => {
      const rows = entries.filter((entry) => entry.pipeline.id === pipeline.id);
      const stages = rows.flatMap((entry) => {
        const column = stageColumn(entry.cells.map((cell) => cell.column));
        const value = entry.cells.find(
          (cell) => cell.column.id === column?.id
        )?.value;
        return typeof value === 'string' && value ? [value] : [];
      });
      const inPipeline = rows.length > 0 || added.includes(pipeline.id);
      let state: PipelineChoiceState = 'available';
      if (pipeline.grant !== 'owner' && pipeline.grant !== 'edit')
        state = 'view-only';
      else if (inPipeline && !ADDS_AGAIN[recordType]) state = 'already-in';
      return { pipeline, stages, inPipeline, state };
    })
    .sort((a, b) => a.pipeline.name.localeCompare(b.pipeline.name));
}

/** A new row's values: the columns' own defaults (Outcome, currency), then `initial`. */
export function startingValues(
  columns: readonly DatabaseViewColumn[],
  initial: Record<string, DatabaseCellValue>
): Record<string, DatabaseCellValue> {
  return {
    ...Object.fromEntries(
      columns
        .filter((column) => column.defaultValue !== undefined)
        .map((column) => [column.id, column.defaultValue ?? null])
    ),
    ...initial,
  };
}

/** How choosing `stage` adds the record: at once, or through the form when the stage requires fields. */
export type StageAddition =
  | { kind: 'add'; values: Record<string, DatabaseCellValue> }
  | { kind: 'form'; initialValues: Record<string, DatabaseCellValue> };

export function stageAddition(
  columns: readonly DatabaseViewColumn[],
  rules: readonly StageRequirement[],
  recordId: string,
  stage: string | undefined
): StageAddition {
  const title = titleColumn(columns);
  const stageField = stageColumn(columns);
  const initialValues =
    stageField && stage !== undefined ? { [stageField.id]: stage } : {};
  if (!title) return { kind: 'form', initialValues };
  const values = startingValues(columns, {
    ...initialValues,
    [title.id]: recordId,
  });
  const missing = missingStageFields(
    requiredStageFields([...columns], [...rules], values).filter(
      (column) => column.id !== title.id
    ),
    values
  );
  return missing.length
    ? { kind: 'form', initialValues }
    : { kind: 'add', values };
}
