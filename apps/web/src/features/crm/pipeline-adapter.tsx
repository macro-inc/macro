import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { getPermissions } from '@core/component/SharePermissions';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { storageServiceClient } from '@service-storage/client';
import { Button } from '@ui';
import { createSignal, onCleanup, onMount, Show, Suspense } from 'solid-js';
import {
  DatabaseMentionPicker,
  DatabaseMentionValue,
  DatabaseTextEditor,
  DatabaseTextValue,
} from '../block-database/database-mentions';
import { DatabaseProvider, useDatabase } from '../database/context/database';
import type { DatabaseViewState } from '../database/core/view-state';
import { DatabaseRecords } from '../database/views/database-records';
import type { Pipeline } from './core/pipeline';
import { createPipelineApi } from './queries/pipeline-data';

/** Pipelines supply their own identity and owner to the existing share dialog. */
export function PipelineShare(props: {
  pipeline: Pipeline;
  onCopyLink(): void;
}) {
  const openShare = useShareModal(() => ({
    id: props.pipeline.id,
    blockAlias: 'database',
    itemType: 'crm_pipeline',
    name: props.pipeline.name,
    owner: props.pipeline.userId,
    userPermissions: getPermissions(props.pipeline.grant),
    copyLink: props.onCopyLink,
  }));
  return (
    <ShareTrigger
      id={props.pipeline.id}
      blockType="database"
      onClick={openShare}
      copyLink={props.onCopyLink}
    />
  );
}

/** The CRM adapter supplies authorized data to the reusable records UI. */
export function PipelineDatabaseEditor(props: { pipeline: Pipeline }) {
  return (
    <Suspense
      fallback={<div class="p-4 text-sm text-ink-muted">Loading pipeline…</div>}
    >
      <Show when={props.pipeline.id} keyed>
        {(_id) => <PipelineRecords pipeline={props.pipeline} />}
      </Show>
    </Suspense>
  );
}

function PipelineRecords(props: { pipeline: Pipeline }) {
  const [view, setView] = createSignal<DatabaseViewState>({
    query: { filter: null },
    layout: { kind: 'table', columns: [] },
  });
  const api = createPipelineApi(storageServiceClient, props.pipeline);
  const canEdit = () =>
    props.pipeline.grant === 'owner' || props.pipeline.grant === 'edit';
  return (
    <StaticMarkdownContext>
      <DatabaseProvider
        api={api}
        tableId={props.pipeline.tableId}
        view={view()}
        capabilities={{ editRows: canEdit(), editColumns: canEdit() }}
      >
        <PipelineRefresh />
        <DatabaseRecords
          view={view()}
          stored={false}
          onViewChange={(change) =>
            setView((previous) => ({ ...previous, ...change }))
          }
          renderTextEditor={(editor) => <DatabaseTextEditor {...editor} />}
          renderTextValue={(value) => <DatabaseTextValue value={value} />}
          renderMentionPicker={(picker) => (
            <DatabaseMentionPicker {...picker} />
          )}
          renderMentionValue={(id, entityType) => (
            <DatabaseMentionValue id={id} entityType={entityType} />
          )}
          renderToolbar={(actions) => (
            <div class="flex items-center justify-between gap-3 border-b border-edge-muted px-4 py-2">
              <span class="text-xs text-ink-muted">
                {props.pipeline.recordType === 'company'
                  ? 'Companies'
                  : 'Contacts'}{' '}
                · Customize columns from their headers
              </span>
              <Show when={canEdit()}>
                <Button
                  size="sm"
                  disabled={actions.pending()}
                  onClick={() => void actions.createRecord()}
                >
                  {props.pipeline.recordType === 'company'
                    ? 'Add company'
                    : 'Add contact'}
                </Button>
              </Show>
            </div>
          )}
        />
      </DatabaseProvider>
    </StaticMarkdownContext>
  );
}

/** CRM owns the polling subscription; the shared source owns invalidation. */
function PipelineRefresh() {
  const database = useDatabase();
  onMount(() => {
    const timer = setInterval(
      () => void database.data.rows.refresh('refresh'),
      5000
    );
    onCleanup(() => clearInterval(timer));
  });
  return null;
}
