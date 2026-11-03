import { catchToResult, throwOnErr } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { queryReadyGate } from '@queries/gate';
import {
  invalidateAllPropertyReads,
  invalidateEntityPropertyReads,
} from '@queries/properties/invalidation';
import { propertiesKeys } from '@queries/properties/keys';
import { refetchSoupEntity } from '@queries/soup/cache';
import { refreshCrmAssociatedSoupQueries } from '@queries/soup/crm-association';
import { propertiesServiceClient } from '@service-properties/client';
import type { PropertyDefinitionResponse } from '@service-properties/generated/schemas/propertyDefinitionResponse';
import { type QueryClient, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { FileTypesSource } from '../context/file-types';
import {
  DEFAULT_FILE_TYPES,
  FILE_TYPE_PROPERTY_NAME,
  type FileClassification,
  type FileTypeCatalog,
} from '../core/file-types';
import type { CrmRecordTarget } from '../core/record';

type Dependencies = {
  properties: Pick<
    typeof propertiesServiceClient,
    | 'listProperties'
    | 'getBulkEntityProperties'
    | 'createPropertyDefinition'
    | 'addPropertyOption'
    | 'updatePropertyOption'
    | 'deletePropertyOption'
    | 'setEntityProperty'
    | 'appendCrmFileReferences'
  >;
  client: QueryClient;
};

function traceFileTypeAction(
  action: 'initialize' | 'add' | 'rename' | 'remove',
  teamId: string | undefined,
  operation: (span: Span) => Promise<void>
) {
  return Telemetry.span(`crm.file_type.${action}`, async (span) => {
    if (teamId) span.setAttr('team.id', teamId);
    try {
      await operation(span);
      span.setAttr('outcome', 'success');
    } catch (error) {
      span.setAttr('outcome', 'error');
      span.error(error);
      throw error;
    }
  });
}

export function decodeFileTypes(
  definitions: PropertyDefinitionResponse[],
  teamId: string
): FileTypeCatalog | null {
  const match = definitions.find((entry) => {
    const definition = 'definition' in entry ? entry.definition : entry;
    return (
      definition.display_name === FILE_TYPE_PROPERTY_NAME &&
      definition.owner.scope === 'team' &&
      definition.owner.team_id === teamId
    );
  });
  if (!match) return null;
  if (
    !('definition' in match) ||
    match.definition.data_type !== 'SELECT_STRING' ||
    match.definition.is_multi_select
  ) {
    throw new Error(
      'The team’s File type property must be a single-select text property.'
    );
  }
  return {
    definitionId: match.definition.id,
    options: [...match.property_options]
      .sort((a, b) => a.display_order - b.display_order)
      .flatMap((option) =>
        option.value.type === 'string'
          ? [{ id: option.id, name: option.value.value }]
          : []
      ),
  };
}

function catalogOptions(
  deps: Dependencies,
  userId: string | undefined,
  teamId: string | undefined
) {
  return {
    queryKey: [
      ...propertiesKeys.definitions({ scope: 'team', includeOptions: true })
        .queryKey,
      userId,
      teamId,
    ],
    enabled: !!userId && !!teamId,
    queryFn: async () =>
      decodeFileTypes(
        await throwOnErr(() =>
          deps.properties.listProperties({
            scope: 'team',
            include_options: true,
          })
        ),
        teamId ?? ''
      ),
    staleTime: 0,
    refetchInterval: 30_000,
    reconcile: 'id',
  };
}

function classificationOptions(
  deps: Dependencies,
  userId: string | undefined,
  catalog: FileTypeCatalog | null | undefined,
  ids: string[]
) {
  return {
    queryKey: propertiesKeys.entityBatch({
      userId,
      entityType: 'DOCUMENT',
      propertyIds: catalog ? [catalog.definitionId] : [],
      entityIds: ids,
    }).queryKey,
    enabled: !!userId && catalog !== undefined && ids.length > 0,
    queryFn: async () => {
      const result = new Map<string, FileClassification>();
      if (!catalog) return new Map(ids.map((id) => [id, null]));
      for (let offset = 0; offset < ids.length; offset += 100) {
        const page = await throwOnErr(() =>
          deps.properties.getBulkEntityProperties({
            body: {
              entities: ids
                .slice(offset, offset + 100)
                .map((entity_id) => ({ entity_id, entity_type: 'DOCUMENT' })),
              property_ids: [catalog.definitionId],
            },
          })
        );
        for (const [id, entity] of Object.entries(page)) {
          const value = entity.properties.find(
            (property) => property.definition.id === catalog.definitionId
          )?.value;
          result.set(
            id,
            value?.type === 'SelectOption' ? (value.value[0] ?? null) : null
          );
        }
      }
      return result;
    },
    staleTime: 0,
    refetchInterval: 30_000,
  };
}

export function createFileTypesSource(
  dependencies: {
    client: QueryClient;
    properties?: Dependencies['properties'];
  },
  userId: Accessor<string | undefined>,
  teamId: Accessor<string | undefined>,
  host: Pick<FileTypesSource, 'candidates' | 'canEdit' | 'create'>
): FileTypesSource {
  const deps: Dependencies = {
    client: dependencies.client,
    properties: dependencies.properties ?? propertiesServiceClient,
  };
  const sessionKey = () =>
    userId() && teamId() ? `${userId()}:${teamId()}` : undefined;
  const requireSession = (session: string | undefined) => {
    if (!session || session !== sessionKey())
      throw new Error('The signed-in user or team changed.');
  };
  const catalog = useQuery(
    () => catalogOptions(deps, userId(), teamId()),
    () => deps.client
  );
  const data = () => (queryReadyGate(catalog) ? catalog.data : undefined);
  const requireCatalog = () => {
    const value = data();
    if (!value) throw new Error('Set up file types first.');
    return value;
  };
  const refreshTypes = () => invalidateAllPropertyReads(deps.client);
  async function refreshFile(id: string) {
    await Promise.all([
      invalidateEntityPropertyReads(deps.client, 'DOCUMENT', id),
      refetchSoupEntity(id, 'document', { refreshGraphql: true }),
      refreshCrmAssociatedSoupQueries(),
    ]);
  }
  const initialize = useMutation(
    () => ({
      networkMode: 'always',
      retry: false,
      mutationFn: (session: string | undefined) =>
        traceFileTypeAction('initialize', teamId(), async (span) => {
          requireSession(session);
          const owner = teamId();
          if (!owner) throw new Error('Join a team to manage file types.');
          const existing = await span.span('crm.file_type.read', () =>
            deps.client.fetchQuery(catalogOptions(deps, userId(), owner))
          );
          requireSession(session);
          if (existing) {
            span.setAttr('file_type.exists', true);
            return;
          }
          const created = await span.span('crm.file_type.write', () =>
            deps.properties.createPropertyDefinition({
              body: {
                scope: 'team',
                display_name: FILE_TYPE_PROPERTY_NAME,
                data_type: {
                  type: 'select_string',
                  multi: false,
                  options: DEFAULT_FILE_TYPES.map((value, display_order) => ({
                    value,
                    display_order,
                  })),
                },
              },
            })
          );
          // A concurrent setup may have won the team's unique property-name constraint.
          if (created.isErr()) {
            const current = await span.span('crm.file_type.read', () =>
              deps.client.fetchQuery(catalogOptions(deps, userId(), owner))
            );
            if (!current) await throwOnErr(() => Promise.resolve(created));
            span.setAttr('file_type.concurrent_setup', true);
          }
          const refreshed = await span.span('crm.file_type.refresh', () =>
            catchToResult(refreshTypes)
          );
          if (refreshed.isErr()) span.error('File types saved; refresh failed');
        }),
    }),
    () => deps.client
  );
  const add = useMutation(
    () => ({
      networkMode: 'always',
      retry: false,
      mutationFn: ({
        session,
        name,
      }: {
        session: string | undefined;
        name: string;
      }) =>
        traceFileTypeAction('add', teamId(), async (span) => {
          requireSession(session);
          const current = requireCatalog();
          span.setAttr('property.id', current.definitionId);
          await span.span('crm.file_type.write', () =>
            throwOnErr(() =>
              deps.properties.addPropertyOption({
                definition_id: current.definitionId,
                body: {
                  type: 'select_string',
                  option: {
                    value: name,
                    display_order: current.options.length,
                  },
                },
              })
            )
          );
          const refreshed = await span.span('crm.file_type.refresh', () =>
            catchToResult(refreshTypes)
          );
          if (refreshed.isErr()) span.error('File type added; refresh failed');
        }),
    }),
    () => deps.client
  );
  const rename = useMutation(
    () => ({
      networkMode: 'always',
      retry: false,
      mutationFn: ({
        session,
        optionId,
        name,
      }: {
        session: string | undefined;
        optionId: string;
        name: string;
      }) =>
        traceFileTypeAction('rename', teamId(), async (span) => {
          requireSession(session);
          const current = requireCatalog();
          span.setAttr('property.id', current.definitionId);
          span.setAttr('property.option_id', optionId);
          await span.span('crm.file_type.write', () =>
            throwOnErr(() =>
              deps.properties.updatePropertyOption({
                definition_id: current.definitionId,
                option_id: optionId,
                body: { value: name },
              })
            )
          );
          const refreshed = await span.span('crm.file_type.refresh', () =>
            catchToResult(refreshTypes)
          );
          if (refreshed.isErr())
            span.error('File type renamed; refresh failed');
        }),
    }),
    () => deps.client
  );
  const remove = useMutation(
    () => ({
      networkMode: 'always',
      retry: false,
      mutationFn: ({
        session,
        optionId,
      }: {
        session: string | undefined;
        optionId: string;
      }) =>
        traceFileTypeAction('remove', teamId(), async (span) => {
          requireSession(session);
          const current = requireCatalog();
          span.setAttr('property.id', current.definitionId);
          span.setAttr('property.option_id', optionId);
          await span.span('crm.file_type.write', () =>
            throwOnErr(() =>
              deps.properties.deletePropertyOption({
                definition_id: current.definitionId,
                option_id: optionId,
              })
            )
          );
          const refreshed = await span.span('crm.file_type.refresh', () =>
            catchToResult(() =>
              Promise.all([
                refreshTypes(),
                deps.client.invalidateQueries({
                  queryKey: propertiesKeys.entityBatch._def,
                }),
              ])
            )
          );
          if (refreshed.isErr())
            span.error('File type removed; refresh failed');
        }),
    }),
    () => deps.client
  );
  const classify = useMutation(
    () => ({
      networkMode: 'always',
      retry: false,
      mutationFn: async ({
        session,
        documentId,
        optionId,
      }: {
        session: string | undefined;
        documentId: string;
        optionId: string | null;
      }) => {
        requireSession(session);
        const current = requireCatalog();
        if (
          optionId &&
          !current.options.some((option) => option.id === optionId)
        )
          throw new Error('This file type no longer exists.');
        await Telemetry.span('crm.file.classify', async (span) => {
          span.setAttr('document.id', documentId);
          await throwOnErr(() =>
            deps.properties.setEntityProperty({
              entity_type: 'DOCUMENT',
              entity_id: documentId,
              property_id: current.definitionId,
              body: {
                value: optionId
                  ? { type: 'select_option', option_id: optionId }
                  : null,
              },
            })
          );
          // A refresh failure must never turn a committed classification into a failed write.
          const refreshed = await catchToResult(() => refreshFile(documentId));
          if (refreshed.isErr())
            span.error('File classification saved; refresh failed');
        });
      },
    }),
    () => deps.client
  );
  const attach = useMutation(
    () => ({
      networkMode: 'always',
      retry: false,
      mutationFn: async ({
        session,
        documentId,
        record,
      }: {
        session: string | undefined;
        documentId: string;
        record: CrmRecordTarget;
      }) => {
        requireSession(session);
        await Telemetry.span('crm.file.attach', async (span) => {
          span.setAttr('document.id', documentId);
          span.setAttr('crm.record.id', record.id);
          const { propertyId, entityType } = match(record.type)
            .with('company', () => ({
              propertyId: SYSTEM_PROPERTY_IDS.COMPANIES,
              entityType: 'COMPANY' as const,
            }))
            .with('contact', () => ({
              propertyId: SYSTEM_PROPERTY_IDS.CONTACTS,
              entityType: 'CONTACT' as const,
            }))
            .exhaustive(() => {
              throw new Error(
                'This record type does not support file attachments.'
              );
            });
          await throwOnErr(() =>
            deps.properties.appendCrmFileReferences({
              entity_type: 'DOCUMENT',
              entity_id: documentId,
              property_id: propertyId,
              body: {
                value: {
                  type: 'multi_entity_reference',
                  references: [
                    { entity_id: record.id, entity_type: entityType },
                  ],
                },
              },
            })
          );
          const refreshed = await catchToResult(() => refreshFile(documentId));
          if (refreshed.isErr()) span.error('File attached; refresh failed');
        });
      },
    }),
    () => deps.client
  );
  return {
    ...host,
    sessionKey,
    data,
    pending: () => catalog.isPending,
    error: () => catalog.isError,
    refresh: () => catalog.refetch(),
    canManage: () => !!userId() && !!teamId(),
    initialize: () => initialize.mutateAsync(sessionKey()),
    add: (name) => add.mutateAsync({ session: sessionKey(), name }),
    rename: (optionId, name) =>
      rename.mutateAsync({ session: sessionKey(), optionId, name }),
    remove: (optionId) =>
      remove.mutateAsync({ session: sessionKey(), optionId }),
    classify: (documentId, optionId) =>
      classify.mutateAsync({ session: sessionKey(), documentId, optionId }),
    attach: (documentId, record) =>
      attach.mutateAsync({ session: sessionKey(), documentId, record }),
    classifications(ids) {
      const query = useQuery(
        () => classificationOptions(deps, userId(), data(), ids()),
        () => deps.client
      );
      return {
        data: () => (queryReadyGate(query) ? query.data : undefined),
        pending: () => query.isPending && ids().length > 0,
        error: () => query.isError,
        refresh: () => query.refetch(),
      };
    },
  };
}
