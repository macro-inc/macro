import { type CrmContext, useCrmContext } from '../context/crm-context';
export const useCompanyQuery = (
  ...args: Parameters<CrmContext['createCompanySource']>
) => useCrmContext().createCompanySource(...args);
export const useContactQuery = (
  ...args: Parameters<CrmContext['createContactSource']>
) => useCrmContext().createContactSource(...args);
export const useCurrentTeamQuery = (
  ...args: Parameters<CrmContext['createTeamSource']>
) => useCrmContext().createTeamSource(...args);
export const useIsTeamAdmin = (
  ...args: Parameters<CrmContext['isTeamAdmin']>
) => useCrmContext().isTeamAdmin(...args);
export const useTeamCrmConfig = (
  ...args: Parameters<CrmContext['createTeamConfigSource']>
) => useCrmContext().createTeamConfigSource(...args);
export const useCrmPermissions = (
  ...args: Parameters<CrmContext['createCapabilities']>
) => useCrmContext().createCapabilities(...args);
export const useDealStages = (
  ...args: Parameters<CrmContext['createDealStages']>
) => useCrmContext().createDealStages(...args);
export const useCrmUnavailable = (
  ...args: Parameters<CrmContext['createUnavailable']>
) => useCrmContext().createUnavailable(...args);
export const useClosedStageIds = (
  ...args: Parameters<CrmContext['createClosedStageIds']>
) => useCrmContext().createClosedStageIds(...args);
export const usePersonalCrmViews = (
  ...args: Parameters<CrmContext['createPersonalViews']>
) => useCrmContext().createPersonalViews(...args);
export const useTeamCrmViews = (
  ...args: Parameters<CrmContext['createTeamViews']>
) => useCrmContext().createTeamViews(...args);
export const useCrmLists = (...args: Parameters<CrmContext['createLists']>) =>
  useCrmContext().createLists(...args);
export const useCreateCompanyMutation = (
  ...args: Parameters<CrmContext['createCompany']>
) => useCrmContext().createCompany(...args);
export const useCreateContactMutation = (
  ...args: Parameters<CrmContext['createContact']>
) => useCrmContext().createContact(...args);
export const useSetCompanyNameMutation = (
  ...args: Parameters<CrmContext['renameCompany']>
) => useCrmContext().renameCompany(...args);
export const useSetContactNameMutation = (
  ...args: Parameters<CrmContext['renameContact']>
) => useCrmContext().renameContact(...args);
export const useSetCompanyHiddenMutation = (
  ...args: Parameters<CrmContext['hideCompany']>
) => useCrmContext().hideCompany(...args);
export const useSetContactHiddenMutation = (
  ...args: Parameters<CrmContext['hideContact']>
) => useCrmContext().hideContact(...args);
export const useSetEmailSyncMutation = (
  ...args: Parameters<CrmContext['setEmailSync']>
) => useCrmContext().setEmailSync(...args);

export const useCrmDisplayOptions = () =>
  useCrmContext().createDisplayOptions();
export const useCrmUserId = () => useCrmContext().userId;
export const useCompanyEmailsQuery = (
  ...args: Parameters<CrmContext['createCompanyEmails']>
) => useCrmContext().createCompanyEmails(...args);
export const useContactEmailsQuery = (
  ...args: Parameters<CrmContext['createContactEmails']>
) => useCrmContext().createContactEmails(...args);
export const useBulkSaveEntityPropertiesMutation = (
  ...args: Parameters<CrmContext['createPropertyCommands']>
) => useCrmContext().createPropertyCommands(...args);
export const usePatchTeamCrmSettingsMutation = (
  ...args: Parameters<CrmContext['createSettingsCommands']>
) => useCrmContext().createSettingsCommands(...args);
export const useReplaceCrmStagesMutation = (
  ...args: Parameters<CrmContext['createReplaceStages']>
) => useCrmContext().createReplaceStages(...args);
export const useResetCrmStagesMutation = (
  ...args: Parameters<CrmContext['createResetStages']>
) => useCrmContext().createResetStages(...args);
export const useQuickAccessCrmCompaniesQuery = (
  ...args: Parameters<CrmContext['createCompanySuggestions']>
) => useCrmContext().createCompanySuggestions(...args);
