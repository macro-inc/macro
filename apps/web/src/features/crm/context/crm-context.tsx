import type { ListFilterGroup } from '@app/components/view-shell';
import type { CrmCompanyEntity } from '@entity';
import {
  type Accessor,
  type Component,
  createContext,
  useContext,
} from 'solid-js';
import type { SetStoreFunction, Store } from 'solid-js/store';
import type { CrmActivityViewState } from '../core/activity-view';
import type { ContactEmailChange, CrmContact } from '../core/contact';

export type ActivityFilters = {
  groups: Accessor<ListFilterGroup<string, string>[]>;
  activeCount: Accessor<number>;
  isSelected(group: string, option: string): boolean;
  selectedIds(group: string): string[];
  setSelected(group: string, option: string, selected: boolean): void;
  clear(): void;
};

import type {
  CrmDisplayOptions,
  CrmListColumnId,
} from '../core/display-options';
import type {
  EmailPrivacy,
  EmailPrivacyChange,
  ExcludedThreads,
} from '../core/email-privacy';
import type { CrmActivityTab } from '../core/navigation';
import type { Pipeline } from '../core/pipeline';
import type { PipelineEntryRecord } from '../core/pipeline-entry';
import type { CrmRecordScope, CrmTaskRecord } from '../core/record';
import type {
  BlockedDomainsSource,
  CompanyContactsFilter,
  CompanyContactsSource,
  CompanyImporter,
  CompanySource,
  ContactSource,
  CrmCapabilities,
  CrmEmailScope,
  CrmEmailSignal,
  CrmMutation,
  CrmQuery,
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
import type { EmailPolicySource } from './email-policy';
import type {
  AddToPipelineSource,
  PipelineEditor,
  PipelineEntriesView,
  PipelineSharing,
  PipelinesSource,
  PipelineTransfer,
} from './pipelines';

export type CrmContext = {
  /** Admitted record data; pending/error stay gated. Pipeline grants are separate. */
  canAccess: Accessor<boolean>;
  accessState: Accessor<'pending' | 'allowed' | 'denied' | 'error'>;
  retryAccess(): Promise<unknown>;
  createEmailPolicy(): EmailPolicySource;
  /** Owner-scoped email reference, available independently of CRM viewing access. */
  EmailThreadMention: Component<{
    threadId: string;
    subject: string;
    onOpened?: () => void;
  }>;
  createEmailPrivacy(): {
    createExcludedThreads(
      after: Accessor<string | undefined>
    ): CrmQuery<ExcludedThreads>;
    query: CrmQuery<EmailPrivacy>;
    update: CrmMutation<EmailPrivacyChange, EmailPrivacy>;
  };
  createPipelines(teamId: Accessor<string | undefined>): PipelinesSource;
  PipelineEditor: PipelineEditor;
  PipelineEntries: PipelineEntriesView;
  /** Call when the record page's Add to pipeline menu first opens. */
  createAddToPipeline(
    record: Accessor<PipelineEntryRecord>
  ): AddToPipelineSource;
  PipelineSharing: PipelineSharing;
  /** CRM settings' Who can use CRM; renders nothing for viewers who can't change it. */
  MemberAccess: Component;
  createPipelineTransfer(pipeline: Pipeline): PipelineTransfer;
  downloadCsv(content: string, filename: string): Promise<{ saved: boolean }>;
  /** Profile picture lookup for a contact; presentation owns the fallback. */
  createContactPhoto?(email: string): Accessor<string | undefined>;
  contactInitials(name: string | null | undefined, email: string): string;
  userEmail(id: string): string;
  copyViewLink(
    config: import('../core/saved-view').CrmViewConfig,
    options?: { silent?: boolean }
  ): Promise<boolean>;
  copyPipelineLink(pipelineId: string): void;
  copyRecordLink(target: {
    type: 'company' | 'contact';
    id: string;
  }): Promise<boolean>;
  createNavigation(): {
    splitId: string | undefined;
    openWithSplit(
      target: { type: 'company' | 'contact' | 'email'; id: string },
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
    emails: Accessor<string[]>,
    scope: Accessor<CrmEmailScope>,
    signal: Accessor<CrmEmailSignal>
  ): ItemListSource;
  /** Paged CRM-wide activity, limited to associated records. */
  createActivity(
    tab: Accessor<CrmActivityTab>,
    options?: Accessor<CrmActivityViewState>
  ): ItemListSource;
  openCreateItem(kind: 'notes' | 'calls'): void;
  openEmailComposer(recipient?: string): void;
  createActivityState(
    tab: CrmActivityTab
  ): readonly [
    Store<CrmActivityViewState>,
    SetStoreFunction<CrmActivityViewState>,
  ];
  createActivityFilters(
    tab: CrmActivityTab,
    state: Store<CrmActivityViewState>,
    setState: SetStoreFunction<CrmActivityViewState>
  ): ActivityFilters;
  ActivityTasks: Component<{ title?: import('solid-js').JSX.Element }>;
  openTaskComposer(
    options?: import('../../tasks-view/types').TaskCreateOptions
  ): void;
  /** Newest mounted record source wins; cleanup restores the parent record source. */
  registerTaskComposerRecord(
    source: Accessor<CrmTaskRecord | undefined>
  ): () => void;
  /** Files associated with the record or attached to its emails. */
  createRecordFiles(
    scope: Accessor<CrmRecordScope | undefined>
  ): ItemListSource;
  /** Calls associated with the record. */
  createRecordCalls(
    scope: Accessor<CrmRecordScope | undefined>
  ): ItemListSource;
  /** Items associated with the record through properties or references. */
  createRecordReferences(
    scope: Accessor<CrmRecordScope | undefined>
  ): ItemListSource;
  /** The record's Tasks tab, scoped to tasks associated with it. */
  RecordTasks: Component<{ scope: CrmRecordScope }>;
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
    companies: Accessor<
      { id: string; name: string; domains: { domain: string }[] }[]
    >;
    query: { readonly isLoading: boolean };
  };
  createContactSuggestions(): {
    contacts: Accessor<{ id: string; name: string; email?: string | null }[]>;
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
  /** Without a company, the dialog asks which company the contact joins. */
  openCreateContact(company?: { companyId: string }): void;
  userId: Accessor<string | undefined>;
  isTeamAdmin: () => Accessor<boolean>;
  createCompanySource(id: Accessor<string>): CompanySource;
  /** A company's Team list; disabled while `filter` is undefined. */
  createCompanyContactsSource(
    filter: Accessor<CompanyContactsFilter | undefined>
  ): CompanyContactsSource;
  createContactSource(id: Accessor<string>): ContactSource;
  createTeamSource(): TeamSource;
  createTeamConfigSource(): TeamConfigSource;
  createBlockedDomains(): BlockedDomainsSource;
  createCapabilities(): CrmCapabilities;
  createDealStages(): DealStages;
  createPersonalViews(): PersonalViewsSource;
  createTeamViews(): TeamViewsSource;
  createLists(teamId: Accessor<string | undefined>): ListsSource;
  createCompany(): CrmMutation<
    { name: string; domain?: string },
    { id: string }
  >;
  createCompanyImporter(): CompanyImporter;
  createContact(): CrmMutation<
    { companyId?: string; name: string; email?: string },
    { id: string }
  >;
  renameCompany(): CrmMutation<{ companyId: string; name: string }>;
  renameContact(): CrmMutation<{
    contactId: string;
    companyId?: string | null;
    name: string;
  }>;
  editContactEmail(): CrmMutation<
    { contact: CrmContact; email: string; change: ContactEmailChange },
    CrmContact
  >;
  editContactCompany(): CrmMutation<
    { contact: CrmContact; companyId: string | null },
    CrmContact
  >;
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
