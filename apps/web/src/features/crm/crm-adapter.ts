import { useCreateContext } from '@app/features/command/context/create-context';
import { useQuickAccessCrmCompaniesQuery } from '@app/features/crm/crm-search';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import {
  enableCrmActivity,
  enableCrmLists,
  enableCrmPipelines,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { useProfilePictureUrl } from '@core/signal/profilePicture';
import { emailToMacroId, getInitialsFromName } from '@core/user';
import { idToEmail } from '@core/user/util';
import { queryReadyGate } from '@queries/gate';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import {
  type SoupAstItemsQuery,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { getSoupEntityById } from '@queries/soup/normalized-cache';
import {
  invalidateUserTeams,
  useCurrentTeamQuery,
  useIsTeamAdmin,
} from '@queries/team/teams';
import { patchTeamCrmSettings } from '@service-auth/crm';
import { storageServiceClient } from '@service-storage/client';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { useQueryClient } from '@tanstack/solid-query';
import { createMemo, lazy } from 'solid-js';
import type { CrmContext } from './context/crm-context';
import type { CrmQuery, ItemListSource } from './context/crm-sources';
import {
  openCreateCompanyModal,
  openCreateContactModal,
} from './creation-adapter';
import { createAppCrmDisplayOptions } from './display-adapter';
import { downloadCrmCsv } from './download-adapter';
import {
  copyCrmPipelineLink,
  copyCrmRecordLink,
  copyCrmViewLink,
  createAppCrmNavigation,
} from './navigation-adapter';
import { PipelineDatabaseEditor, PipelineShare } from './pipeline-adapter';
import { createCrmPipelineEntries } from './pipeline-entries-adapter';
import { createCrmPermissions } from './primitives/team-config';
import { useCrmActivityQuery } from './queries/activity';
import {
  createCompanyImporter,
  useCompanyQuery,
  useCreateCompanyMutation,
  useCreateContactMutation,
  useSetCompanyHiddenMutation,
  useSetCompanyNameMutation,
  useSetEmailSyncMutation,
} from './queries/companies';
import { useCompanyEmailsQuery } from './queries/company-emails';
import { useContactEmailsQuery } from './queries/contact-emails';
import {
  useContactQuery,
  useSetContactHiddenMutation,
  useSetContactNameMutation,
} from './queries/contacts';
import { fetchCrmExportCompanies } from './queries/export';
import { useCrmLists } from './queries/lists';
import { createPipelineTransfer } from './queries/pipeline-transfer';
import { createPipelinesSource } from './queries/pipelines';
import {
  recordListFailure,
  useRecordCallsQuery,
  useRecordFilesQuery,
  useRecordReferencesQuery,
} from './queries/record-items';
import { usePersonalCrmViews, useTeamCrmViews } from './queries/saved-views';
import { usePatchTeamCrmSettingsMutation } from './queries/settings-commands';
import {
  useReplaceCrmStagesMutation,
  useResetCrmStagesMutation,
} from './queries/stages';
import { useTeamCrmConfig } from './queries/team-config';
import { useQuickAccessCrmContactsQuery } from './record-adapter';
import { createAppDealStages } from './stage-adapter';
import { crmTaskComposerContext } from './task-composer';

// Loaded on demand: the Tasks list imports soup, which imports CRM entry points.
const CrmRecordTasks = lazy(async () => ({
  default: (await import('./record-tasks-adapter')).CrmRecordTasks,
}));

/**
 * Soup rows carry raw notification arrays; `ListEntity` reads them through
 * an accessor bound to the app's notification source, as other lists do.
 */
function withRowNotifications(source: SoupAstItemsQuery): ItemListSource {
  const notificationSource = useGlobalNotificationSource();
  // Reading `data` before the first page resolves would suspend the tab.
  const data = createMemo(() =>
    queryReadyGate(source)
      ? {
          entities: source.data.entities.map((entity) =>
            withEntityNotifications(entity, notificationSource)
          ),
        }
      : undefined
  );
  return {
    get isPending() {
      return source.isPending;
    },
    get isEnabled() {
      return source.isEnabled;
    },
    get isLoading() {
      return source.isLoading;
    },
    get data() {
      return data();
    },
    get hasNextPage() {
      return source.hasNextPage;
    },
    get isFetchingNextPage() {
      return source.isFetchingNextPage;
    },
    get isError() {
      return recordListFailure(source).isError;
    },
    get isFetchNextPageError() {
      return recordListFailure(source).isFetchNextPageError;
    },
    fetchNextPage: () => source.fetchNextPage(),
    refetch: () => source.refetch(),
  };
}

/**
 * A query contract whose `data` reads as `undefined` until the query is
 * ready, so views can read it eagerly (e.g. in a memo) without suspending.
 */
function withReadyGate<T>(query: CrmQuery<T>): CrmQuery<T> {
  return {
    get data() {
      return queryReadyGate(query) ? query.data : undefined;
    },
    get isPending() {
      return query.isPending;
    },
    get isSuccess() {
      return query.isSuccess;
    },
    get isLoading() {
      return query.isLoading;
    },
    get isError() {
      return query.isError;
    },
    refetch: () => query.refetch(),
  };
}

/** Only this app-facing adapter constructs production capabilities. */
export function createAppCrmContext(): CrmContext {
  const deps = {
    client: useQueryClient(),
    storage: storageServiceClient,
    feedback: toast,
  };
  const userId = useUserId();
  const layout = useSplitLayout();
  const panel = useSplitPanel();
  const createContext = useCreateContext();
  const activityFlag = useFeatureFlag(enableCrmActivity);
  const createSettings = () => useTeamCrmConfig(deps);
  return {
    registerTaskComposerRecord(source) {
      if (!panel) return () => {};
      return createContext.register(panel.handle.id, () => ({
        task: activityFlag().enabled ? crmTaskComposerContext(source()) : null,
      }));
    },
    createPipelines: (teamId) => createPipelinesSource(deps, teamId),
    PipelineEditor: PipelineDatabaseEditor,
    PipelineEntries: createCrmPipelineEntries({
      graphql: getGraphqlSoupClient,
      storage: deps.storage,
    }),
    PipelineSharing: PipelineShare,
    createPipelineTransfer: (pipeline) =>
      createPipelineTransfer(deps, pipeline),
    feedback: toast,
    downloadCsv: downloadCrmCsv,
    createContactPhoto: (email) =>
      useProfilePictureUrl(emailToMacroId(email))[0],
    contactInitials: getInitialsFromName,
    userEmail: idToEmail,
    createNavigation: createAppCrmNavigation,
    copyRecordLink: copyCrmRecordLink,
    copyViewLink: copyCrmViewLink,
    copyPipelineLink: copyCrmPipelineLink,
    listsEnabled() {
      const flag = useFeatureFlag(enableCrmLists);
      return () => flag().enabled;
    },
    pipelinesEnabled() {
      const flag = useFeatureFlag(enableCrmPipelines);
      return () => flag().enabled;
    },
    createCompanyEmails: (...args) =>
      withRowNotifications(
        useCompanyEmailsQuery(useSoupAstItemsQuery, ...args)
      ),
    createContactEmails: (...args) =>
      withRowNotifications(
        useContactEmailsQuery(useSoupAstItemsQuery, ...args)
      ),
    createActivity: (tab) =>
      withRowNotifications(
        useCrmActivityQuery(deps, useSoupAstItemsQuery, tab, userId)
      ),
    openTaskComposer: () =>
      layout.popoverSplit({
        type: 'component',
        id: 'task-compose',
        params: {
          composerContext: panel
            ? createContext.snapshot('task', panel.handle.id)
            : undefined,
        },
      }),
    createRecordFiles: (scope) =>
      withRowNotifications(useRecordFilesQuery(useSoupAstItemsQuery, scope)),
    createRecordCalls: (scope) =>
      withRowNotifications(useRecordCallsQuery(useSoupAstItemsQuery, scope)),
    createRecordReferences: (scope) =>
      withRowNotifications(
        useRecordReferencesQuery(useSoupAstItemsQuery, scope)
      ),
    RecordTasks: CrmRecordTasks,
    createPropertyCommands: useBulkSaveEntityPropertiesMutation,
    createSettingsCommands: () =>
      usePatchTeamCrmSettingsMutation({
        ...deps,
        patch: patchTeamCrmSettings,
        invalidateTeams: invalidateUserTeams,
      }),
    createReplaceStages: () => useReplaceCrmStagesMutation(deps),
    createResetStages: () => useResetCrmStagesMutation(deps),
    exportCompanies: (...args) =>
      fetchCrmExportCompanies(deps.storage, ...args),
    createCompanySuggestions: useQuickAccessCrmCompaniesQuery,
    createContactSuggestions: useQuickAccessCrmContactsQuery,
    hydrateCompany(company) {
      if (company.properties) return company;
      const cached = getSoupEntityById(company.id);
      return cached?.tag === 'crmCompany'
        ? { ...company, properties: cached.data.properties }
        : company;
    },
    createExportDefinitions(enabled) {
      const query = useListPropertiesQuery(
        () => ({
          scope: 'all',
          includeOptions: true,
          forEntityType: 'COMPANY',
        }),
        enabled
      );
      return {
        get isPending() {
          return query.isPending;
        },
        get isSuccess() {
          return query.isSuccess;
        },
        get isError() {
          return query.isError;
        },
        get data() {
          return (query.data ?? []).map((entry) =>
            'definition' in entry
              ? entry
              : { definition: entry, property_options: [] }
          );
        },
      };
    },
    createDisplayOptions: createAppCrmDisplayOptions,
    openCreateCompany: openCreateCompanyModal,
    openCreateContact: openCreateContactModal,
    userId,
    isTeamAdmin: useIsTeamAdmin,
    createCompanySource: (...args) => useCompanyQuery(deps, ...args),
    createContactSource: (...args) =>
      withReadyGate(useContactQuery(deps, ...args)),
    createTeamSource: useCurrentTeamQuery,
    createTeamConfigSource: createSettings,
    createCapabilities: () =>
      createCrmPermissions(userId, useCurrentTeamQuery(), createSettings()),
    createDealStages: createAppDealStages,
    createPersonalViews: () => usePersonalCrmViews(deps),
    createTeamViews: () => useTeamCrmViews(deps, userId, createSettings()),
    createLists: (teamId) => useCrmLists(deps, teamId),
    createCompany: (...args) => useCreateCompanyMutation(deps, ...args),
    createCompanyImporter: () => createCompanyImporter(deps),
    createContact: (...args) => useCreateContactMutation(deps, ...args),
    renameCompany: (...args) => useSetCompanyNameMutation(deps, ...args),
    renameContact: (...args) => useSetContactNameMutation(deps, ...args),
    hideCompany: (...args) => useSetCompanyHiddenMutation(deps, ...args),
    hideContact: (...args) => useSetContactHiddenMutation(deps, ...args),
    setEmailSync: (...args) => useSetEmailSyncMutation(deps, ...args),
  };
}
