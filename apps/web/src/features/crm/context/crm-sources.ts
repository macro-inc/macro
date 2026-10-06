import type { Property } from '@property/types';
import type { Accessor } from 'solid-js';
import type { CrmCompany } from '../core/company';
import type { CrmContact } from '../core/contact';
import type { CrmListConfig } from '../core/navigation';
import type { CrmViewConfig } from '../core/saved-view';
import type {
  CrmPermissions,
  CrmTeamRole,
  TeamCrmConfig,
  TeamCrmConfigPatch,
  TeamCrmSavedView,
} from '../core/team-config';

/** Query availability without exposing a cache client or transport result. */
export type CrmQuery<T> = {
  readonly data: T | undefined;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly isLoading: boolean;
  readonly isError: boolean;
  refetch(): Promise<unknown>;
};
export type CrmMutation<Input, Output = unknown> = {
  readonly isPending: boolean;
  mutate(
    input: Input,
    options?: {
      onSuccess?: (value: Output) => void;
      onError?: (error: Error) => void;
      onSettled?: () => void;
    }
  ): void;
  mutateAsync(input: Input): Promise<Output>;
};
export type CompanySource = {
  query: CrmQuery<unknown>;
  company: Accessor<CrmCompany | undefined>;
  contacts: Accessor<CrmContact[]>;
};
export type ContactSource = CrmQuery<CrmContact>;
export type TeamSource = CrmQuery<{
  team: { id: string; crm_enabled: boolean };
  members: { user_id: string; role: CrmTeamRole }[];
} | null>;
export type TeamConfigSource = {
  config: Accessor<TeamCrmConfig>;
  isLoading: Accessor<boolean>;
  isError: Accessor<boolean>;
  update: CrmMutation<TeamCrmConfigPatch>;
};
export type CrmCapabilities = {
  role: Accessor<CrmTeamRole | undefined>;
  permissions: Accessor<CrmPermissions>;
  isLoading: Accessor<boolean>;
  canEditCrm: Accessor<boolean>;
  canEditStages: Accessor<boolean>;
  canMoveClosedDeals: Accessor<boolean>;
  canDeleteRecords: Accessor<boolean>;
};

import type { DealStage } from '../core/stages';

export type { DealStage } from '../core/stages';
export type DealStages = {
  stages: Accessor<DealStage[]>;
  filterStages: Accessor<DealStage[]>;
  isCustomized: Accessor<boolean>;
  stageDefinitionId: Accessor<string>;
  stageProperty: Accessor<Property>;
  resolveStage: (company: {
    properties?: { definition: { id: string }; value?: unknown }[] | null;
  }) => string | undefined;
  stageLabel: (id: string) => string | undefined;
  isLoading: Accessor<boolean>;
  isError: Accessor<boolean>;
};
export type PersonalCrmView = {
  id: string;
  name: string;
  config: CrmViewConfig;
};
export type PersonalViewsSource = {
  views: Accessor<PersonalCrmView[]>;
  defaultView: Accessor<PersonalCrmView | undefined>;
  isLoading: Accessor<boolean>;
  create: CrmMutation<{ name: string; config: CrmViewConfig }>;
  rename: CrmMutation<{ id: string; name: string }>;
  remove: CrmMutation<{ id: string }>;
  setDefault: CrmMutation<{ id: string | undefined }>;
};
export type TeamViewsSource = {
  views: Accessor<TeamCrmSavedView[]>;
  defaultViewId: Accessor<string | undefined>;
  defaultView: Accessor<TeamCrmSavedView | undefined>;
  add(name: string, config: CrmViewConfig): void;
  remove(id: string): void;
  setDefault(id: string | undefined): void;
  isLoading: Accessor<boolean>;
  isSaving: Accessor<boolean>;
};
export type ListsSource = {
  query: CrmQuery<unknown>;
  lists: Accessor<{ id: string; name: string; config: CrmListConfig }[]>;
  save: CrmMutation<
    { id?: string; name: string; companyIds: string[] },
    string
  >;
  remove: CrmMutation<string>;
  setMembership: CrmMutation<{
    listId: string;
    companyId: string;
    included: boolean;
  }>;
};

export type CrmEmailScope = 'team' | 'me';
export type CrmEmailSignal = 'signal' | 'all';
/** A paged soup list: email threads, files or calls of a CRM record. */
export type ItemListSource = {
  /** True until the first page is readable (including disabled queries). */
  readonly isPending: boolean;
  /** False while the query is disabled, e.g. a company without domains. */
  readonly isEnabled: boolean;
  readonly isLoading: boolean;
  readonly data: { entities: import('@entity').EntityData[] } | undefined;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  fetchNextPage(): Promise<unknown>;
};
export type CompanyPropertySave = {
  properties: {
    entityId: string;
    entityType: 'COMPANY';
    property: Property;
    apiValues: import('@property/types').PropertyApiValues;
  }[];
};
export type PropertyCommands = {
  mutate(value: CompanyPropertySave): void;
  mutateAsync(value: CompanyPropertySave): Promise<void>;
};
export type CrmStageInput = { id?: string | null; label: string };
export type CrmStagesResult = {
  definition_id: string;
  stages: { id: string; label: string }[];
};
export type ExportDefinition = {
  definition: { id: string; display_name: string; is_metadata: boolean };
  property_options: { id: string; value: { value: unknown } }[];
};
export type ExportDefinitionsSource = {
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly isError: boolean;
  readonly data: ExportDefinition[];
};

export type PeopleSource = {
  people: Accessor<import('../core/people').CrmPerson[]>;
  query: {
    readonly isError: boolean;
    readonly isFetching: boolean;
    readonly hasNextPage: boolean;
    readonly isFetchNextPageError: boolean;
    fetchNextPage(): Promise<unknown>;
    refetch(): Promise<unknown>;
  };
};
