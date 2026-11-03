import { useQuickAccess } from '@core/context/quickAccess/context';
import { createMarkdownFile } from '@core/util/create';
import { isDocumentEntity } from '@entity';
import { Telemetry } from '@macro-inc/observability';
import { queryReadyGate } from '@queries/gate';
import { useDocumentAccessLevelQuery } from '@queries/storage/document-metadata';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { useQueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { createFileTypesSource } from './queries/file-types';

export function createAppFileTypes(userId: Accessor<string | undefined>) {
  const team = useCurrentTeamQuery();
  const quickAccess = useQuickAccess();
  return createFileTypesSource(
    { client: useQueryClient() },
    userId,
    () => (queryReadyGate(team) ? team.data?.team.id : undefined),
    {
      canEdit(id) {
        const query = useDocumentAccessLevelQuery(id);
        return () =>
          queryReadyGate(query) &&
          (query.data === 'edit' || query.data === 'owner');
      },
      candidates(query) {
        const list = quickAccess.useList({
          buckets: ['document', 'note'],
          searchTerm: query,
        });
        return {
          files: () =>
            list
              .items()
              .flatMap((item) =>
                item.kind === 'entity' &&
                isDocumentEntity(item.data) &&
                item.data.subType?.type !== 'task'
                  ? [item.data]
                  : []
              ),
          pending: list.isLoading,
          hasMore: list.hasMore,
          loadMore: list.loadMore,
          error: list.error,
        };
      },
      create(name) {
        return Telemetry.span('crm.file.create', async (span) => {
          const id = await createMarkdownFile({
            title: name,
            source: 'crm_files',
          });
          if (!id) throw new Error('Could not create the file.');
          span.setAttr('document.id', id);
          return id;
        });
      },
    }
  );
}
