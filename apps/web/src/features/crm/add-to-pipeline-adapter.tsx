import { Telemetry } from '@macro-inc/observability';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { Client } from '@urql/core';
import { type Accessor, createMemo } from 'solid-js';
import {
  DatabaseLinkValue,
  DatabaseMentionPicker,
  DatabaseMentionValue,
  DatabaseTextEditor,
  DatabaseTextValue,
} from '../block-database/database-mentions';
import { databaseWriteMessage } from '../database/core/write-failure';
import type {
  AddToPipelineSource,
  PipelineRowAdded,
} from './context/pipelines';
import type { PipelineEntryRecord } from './core/pipeline-entry';
import type { CrmQueryDependencies } from './queries/dependencies';
import { pipelineViewColumn } from './queries/pipeline-data';
import {
  addPipelineEntryRow,
  createPipelineEntriesQuery,
} from './queries/pipeline-entries';
import { usePipelineTableQuery } from './queries/pipeline-views';
import { createPipelinesSource } from './queries/pipelines';
import { useStageRequirements } from './queries/stage-requirements';

/**
 * The record page's Add to pipeline menu over production reads: the team's
 * pipelines, the record's rows through the Pipelines card's own query, and a
 * pipeline's schema and stage requirements once its stages or add form show.
 */
export function createAddToPipelineSource(
  deps: CrmQueryDependencies & { graphql: () => Client },
  record: Accessor<PipelineEntryRecord>
): AddToPipelineSource {
  const team = useCurrentTeamQuery();
  const teamId = () => (team.isSuccess ? team.data?.team.id : undefined);
  const pipelines = createPipelinesSource(deps, teamId);
  // The Pipelines card's document and variables, read cache-first: on
  // Overview the card has answered before the menu opens, so the normalized
  // cache serves the menu without a second request (a client without that
  // cache sends it). Elsewhere the first open reads once. An add refetches
  // network-only, which updates both.
  const entries = createPipelineEntriesQuery(
    deps.graphql,
    record,
    'cache-first'
  );
  return {
    pipelines: pipelines.pipelines,
    loading: () =>
      team.isPending ||
      pipelines.loading() ||
      (entries.pending() && !entries.failed()),
    // A failed refetch keeps the list it already has on screen.
    error: () =>
      (team.isError && !queryReadyGate(team)) ||
      (pipelines.error() && pipelines.pipelines().length === 0) ||
      entries.failed(),
    retry: async () => {
      if (!queryReadyGate(team)) await team.refetch();
      await Promise.all([pipelines.refresh(), entries.refetch()]);
    },
    entries: entries.entries,
    createSchema(pipeline) {
      const table = usePipelineTableQuery(deps, pipeline);
      // Read once when the stages first show; a requirement added since is
      // refused by the server's stage guard.
      const requirements = useStageRequirements(deps, pipeline.id, {
        poll: false,
      });
      const columns = createMemo(() =>
        queryReadyGate(table)
          ? table.data.columns.map((column) =>
              pipelineViewColumn(column, pipeline)
            )
          : undefined
      );
      return {
        columns,
        requirements: () =>
          queryReadyGate(requirements.query)
            ? requirements.query.data
            : undefined,
        loading: () => table.isPending || requirements.query.isPending,
        error: () =>
          (!queryReadyGate(table) && table.isError) ||
          (!queryReadyGate(requirements.query) && requirements.query.isError),
      };
    },
    addRow: (pipeline, columns, creation) =>
      Telemetry.span('crm.pipeline.add_from_record', async (span) => {
        span.setAttr('crm.pipeline_id', pipeline.id);
        span.setAttr('crm.record_type', pipeline.recordType);
        const written = await addPipelineEntryRow(
          deps.storage,
          pipeline,
          columns,
          creation.values ?? {},
          creation.option !== undefined
        );
        // An uncertain write may have committed; reading the rows again
        // shows it in the Pipelines card if it did.
        let outcome: PipelineRowAdded = { kind: 'added' };
        if (written.isErr())
          outcome =
            written.error.kind === 'outcome-unknown'
              ? { kind: 'uncertain' }
              : {
                  kind: 'failed',
                  message: databaseWriteMessage(written.error),
                };
        span.setAttr('crm.outcome', outcome.kind);
        if (outcome.kind !== 'failed')
          await span.span('crm.pipeline.entries_refresh', () =>
            entries.refetch()
          );
        return outcome;
      }),
    cells: {
      renderTextEditor: (editor) => <DatabaseTextEditor {...editor} />,
      renderTextValue: (value) => <DatabaseTextValue value={value} />,
      renderLinkValue: (url) => <DatabaseLinkValue url={url} />,
      renderMentionPicker: (picker) => <DatabaseMentionPicker {...picker} />,
      renderMentionValue: (id, entityType) => (
        <DatabaseMentionValue id={id} entityType={entityType} />
      ),
    },
  };
}
