import { useQuickAccessCrmCompaniesQuery } from '@app/features/crm/crm-search';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import { enableCrmLists } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { getInitialsFromName } from '@core/user';
import { idToEmail } from '@core/user/util';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { getSoupEntityById } from '@queries/soup/normalized-cache';
import {
  invalidateUserTeams,
  useCurrentTeamQuery,
  useIsTeamAdmin,
} from '@queries/team/teams';
import { patchTeamCrmSettings } from '@service-auth/crm';
import { storageServiceClient } from '@service-storage/client';
import { useQueryClient } from '@tanstack/solid-query';
import { lazy } from 'solid-js';
import type { CrmContext } from './context/crm-context';
import {
  openCreateCompanyModal,
  openCreateContactModal,
} from './creation-adapter';
import { createAppCrmDisplayOptions } from './display-adapter';
import { downloadCrmCsv } from './download-adapter';
import {
  copyCrmRecordLink,
  copyCrmViewLink,
  createAppCrmNavigation,
} from './navigation-adapter';
import {
  createClosedStageIds,
  createCrmPermissions,
  createCrmUnavailable,
} from './primitives/team-config';
import {
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
import {
  useRecordCallsQuery,
  useRecordFilesQuery,
} from './queries/record-items';
import { usePersonalCrmViews, useTeamCrmViews } from './queries/saved-views';
import { usePatchTeamCrmSettingsMutation } from './queries/settings-commands';
import {
  useReplaceCrmStagesMutation,
  useResetCrmStagesMutation,
} from './queries/stages';
import { useTeamCrmConfig } from './queries/team-config';
import { createAppDealStages } from './stage-adapter';

// Loaded on demand: the Tasks list imports soup, which imports CRM entry points.
const CrmRecordTasks = lazy(async () => ({
  default: (await import('./record-tasks-adapter')).CrmRecordTasks,
}));

/** Only this app-facing adapter constructs production capabilities. */
export function createAppCrmContext(): CrmContext {
  const deps = {
    client: useQueryClient(),
    storage: storageServiceClient,
    feedback: toast,
  };
  const userId = useUserId();
  const createSettings = () => useTeamCrmConfig(deps);
  return {
    feedback: toast,
    downloadCsv: downloadCrmCsv,
    contactInitials: getInitialsFromName,
    userEmail: idToEmail,
    createNavigation: createAppCrmNavigation,
    copyRecordLink: copyCrmRecordLink,
    copyViewLink: copyCrmViewLink,
    listsEnabled() {
      const flag = useFeatureFlag(enableCrmLists);
      return () => flag().enabled;
    },
    createCompanyEmails: (...args) =>
      useCompanyEmailsQuery(useSoupAstItemsQuery, ...args),
    createContactEmails: (...args) =>
      useContactEmailsQuery(useSoupAstItemsQuery, ...args),
    createRecordFiles: (scope) =>
      useRecordFilesQuery(useSoupAstItemsQuery, scope),
    createRecordCalls: (scope) =>
      useRecordCallsQuery(useSoupAstItemsQuery, scope),
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
    createContactSource: (...args) => useContactQuery(deps, ...args),
    createTeamSource: useCurrentTeamQuery,
    createTeamConfigSource: createSettings,
    createCapabilities: () =>
      createCrmPermissions(userId, useCurrentTeamQuery(), createSettings()),
    createDealStages: createAppDealStages,
    createUnavailable: () => createCrmUnavailable(useCurrentTeamQuery()),
    createClosedStageIds: (stages) =>
      createClosedStageIds(createSettings(), stages),
    createPersonalViews: () => usePersonalCrmViews(deps),
    createTeamViews: () => useTeamCrmViews(deps, userId, createSettings()),
    createLists: (teamId) => useCrmLists(deps, teamId),
    createCompany: (...args) => useCreateCompanyMutation(deps, ...args),
    createContact: (...args) => useCreateContactMutation(deps, ...args),
    renameCompany: (...args) => useSetCompanyNameMutation(deps, ...args),
    renameContact: (...args) => useSetContactNameMutation(deps, ...args),
    hideCompany: (...args) => useSetCompanyHiddenMutation(deps, ...args),
    hideContact: (...args) => useSetContactHiddenMutation(deps, ...args),
    setEmailSync: (...args) => useSetEmailSyncMutation(deps, ...args),
  };
}
