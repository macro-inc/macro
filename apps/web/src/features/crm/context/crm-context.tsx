import type { CrmCompanyEntity } from '@entity';
import {
  type Accessor,
  type Component,
  createContext,
  useContext,
} from 'solid-js';
import type {
  CrmDisplayOptions,
  CrmListColumnId,
} from '../core/display-options';
import type { CrmRecordScope } from '../core/record';
import type {
  CompanySource,
  ContactSource,
  CrmCapabilities,
  CrmEmailScope,
  CrmEmailSignal,
  CrmMutation,
  CrmStageInput,
  CrmStagesResult,
  DealStages,
  ExportDefinitionsSource,
  ItemListSource,
  ListsSource,
  PersonalViewsSource,
  PropertyCommands,
  TeamConfigSource,
  TeamSource,
  TeamViewsSource,
} from './crm-sources';

export type CrmContext = {
  downloadCsv(content: string, filename: string): Promise<{ saved: boolean }>;
  contactInitials(name: string | null | undefined, email: string): string;
  userEmail(id: string): string;
  copyViewLink(config: import('../core/saved-view').CrmViewConfig): void;
  copyRecordLink(target: {
    type: 'company' | 'contact';
    id: string;
  }): Promise<void>;
  createNavigation(): {
    splitId: string | undefined;
    openWithSplit(
      target: { type: 'company' | 'contact'; id: string },
      options?: { activate?: boolean; preferNewSplit?: boolean }
    ): void;
    showCompanies(): void;
    /** Open any soup row (email, file, call, ...) in a split. */
    openEntity(entity: import('@entity').EntityData): void;
  };
  listsEnabled(): Accessor<boolean>;

  feedback: { success(message: string): void; failure(message: string): void };
  createCompanyEmails(
    domains: Accessor<string[]>,
    scope: Accessor<CrmEmailScope>,
    signal: Accessor<CrmEmailSignal>
  ): ItemListSource;
  createContactEmails(
    email: Accessor<string | undefined>,
    scope: Accessor<CrmEmailScope>,
    signal: Accessor<CrmEmailSignal>
  ): ItemListSource;
  /** Files associated with the record or attached to its emails. */
  createRecordFiles(
    scope: Accessor<CrmRecordScope | undefined>
  ): ItemListSource;
  /** Calls associated with the record. */
  createRecordCalls(
    scope: Accessor<CrmRecordScope | undefined>
  ): ItemListSource;
  /** The record's Tasks tab, scoped to tasks associated with it. */
  RecordTasks: Component<{ scope: CrmRecordScope }>;
  MarketingEnrollments?: Component<{ email: string }>;
  createPropertyCommands(): PropertyCommands;
  hydrateCompany(company: CrmCompanyEntity): CrmCompanyEntity;
  createSettingsCommands(): CrmMutation<
    { enabled: boolean; backfill?: boolean },
    { enabled: boolean }
  >;
  createReplaceStages(): CrmMutation<CrmStageInput[], CrmStagesResult>;
  createResetStages(): CrmMutation<void>;
  createExportDefinitions(enabled: Accessor<boolean>): ExportDefinitionsSource;
  createCompanySuggestions(): {
    companies: Accessor<{ id: string; name: string }[]>;
    query: { readonly isLoading: boolean };
  };
  exportCompanies(
    signal: AbortSignal,
    progress: (count: number) => void
  ): Promise<CrmCompanyEntity[]>;

  createDisplayOptions(): {
    options: Accessor<CrmDisplayOptions>;
    toggleListColumn(column: CrmListColumnId): void;
  };
  openCreateCompany(): void;
  openCreateContact(companyId: string, domain: string): void;
  userId: Accessor<string | undefined>;
  isTeamAdmin: () => Accessor<boolean>;
  createCompanySource(id: Accessor<string>): CompanySource;
  createContactSource(id: Accessor<string>): ContactSource;
  createTeamSource(): TeamSource;
  createTeamConfigSource(): TeamConfigSource;
  createCapabilities(): CrmCapabilities;
  createDealStages(): DealStages;
  createUnavailable(): Accessor<boolean>;
  createClosedStageIds(
    stages: Accessor<{ id: string; label: string }[]>
  ): Accessor<Set<string>>;
  createPersonalViews(): PersonalViewsSource;
  createTeamViews(): TeamViewsSource;
  createLists(teamId: Accessor<string | undefined>): ListsSource;
  createCompany(): CrmMutation<
    { name: string; domain: string },
    { id: string }
  >;
  createContact(): CrmMutation<
    { companyId: string; name: string; email: string },
    { id: string }
  >;
  renameCompany(): CrmMutation<{ companyId: string; name: string }>;
  renameContact(): CrmMutation<{
    contactId: string;
    companyId: string;
    name: string;
  }>;
  hideCompany(): CrmMutation<{ companyId: string; hidden: boolean }>;
  hideContact(): CrmMutation<{ contactId: string; hidden: boolean }>;
  setEmailSync(): CrmMutation<{ companyId: string; emailSync: boolean }>;
};
const Context = createContext<CrmContext>();
export const CrmProvider = Context.Provider;
export function useCrmContext(): CrmContext {
  const context = useContext(Context);
  if (!context) throw new Error('CRM views require a CrmProvider');
  return context;
}
