import { ViewShell } from '@app/components/view-shell';
import { createCrmAccessAuthority } from '@service-storage/crm-access-authority';
import { Button } from '@ui';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import { createQueryStore } from '../../../next-soup/filters/filter-store/query-store';
import type { PipelineEditor, PipelinesSource } from '../../context/pipelines';
import type { Pipeline } from '../../core/pipeline';
import type { CrmRecordRef, CrmRecordSection } from '../../core/record';
import { useCrmContext as usePrivacyContext } from '../privacy/preview-adapters';

// Keep the production workspace, shell, navigation, authority and privacy source.
// Record bodies, pipeline rows and collection controls are synthetic fixture data.
const params = new URLSearchParams(location.search);
export const authority = createCrmAccessAuthority({
  fetchProof: async () => {
    const response = await fetch('/fixture-authority');
    const policy = response.headers.get('x-macro-crm-access');
    if (!policy) throw new Error('Missing permission proof');
    return policy;
  },
  retire: async () => {},
});
const [activeTab, setTab] = createSignal<string | undefined>(
  params.get('view') === 'pipeline' ? 'pipeline:shared' : 'active'
);
const [records, setRecords] = createSignal<readonly CrmRecordRef[]>([]);
const [section, setSection] = createSignal<CrmRecordSection>();
const [settingsOpen, setSettingsOpen] = createSignal(false);
const [searchText, setSearchText] = createSignal('');
const [stageFilter, setStageFilter] = createSignal<string[]>([]);
const [ownerFilter, setOwnerFilter] = createSignal<string[]>([]);
export const [recordMounts, setRecordMounts] = createSignal(0);
export const [recordDisposals, setRecordDisposals] = createSignal(0);
export function navigate(tab: string | undefined) {
  setRecords([]);
  setSettingsOpen(false);
  setTab(tab);
}
export function openRecord() {
  setRecords([{ type: 'company', id: 'company', name: 'Private company' }]);
}
const queryFilters = createQueryStore();
const pipeline: Pipeline = {
  id: 'shared',
  teamId: 'team',
  name: 'Shared pipeline',
  userId: 'viewer',
  recordType: 'company',
  databaseId: 'database',
  tableId: 'records',
  primaryColumnId: 'company',
  sharing: 'private',
  grant: 'view',
  createdAt: '2026-10-01T00:00:00Z',
  trashedAt: null,
};
const pipelines: PipelinesSource = {
  pipelines: () => [pipeline],
  loading: () => false,
  error: () => false,
  refresh: async () => {},
  create: async () => {
    throw new Error('Read-only fixture');
  },
  rename: async () => {},
  trash: async () => {},
};
const PipelineRows: PipelineEditor = (props) => (
  <section
    data-testid="shared-pipeline"
    class="p-6 pt-[max(1.5rem,var(--mobile-content-inset-top,0px))]"
  >
    <h1 class="text-xl font-semibold">Shared pipeline</h1>
    <table class="mt-4 w-full text-left">
      <thead>
        <tr>
          <th>Record reference</th>
          <th>Stage</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <Button
              variant="ghost"
              onClick={() =>
                props.onOpenRecord?.({ type: 'company', id: 'company' })
              }
            >
              Open referenced record
            </Button>
          </td>
          <td>Qualified</td>
        </tr>
      </tbody>
    </table>
  </section>
);
export function useCrmContext() {
  return {
    ...usePrivacyContext(),
    canAccess: authority.allowed,
    accessState: authority.state,
    retryAccess: authority.refresh,
    listsEnabled: () => () => true,
    createNavigation: () => ({ openWithSplit: openRecord }),
    createPipelines: () => pipelines,
    PipelineEditor: PipelineRows,
    PipelineSharing: () => null,
    createPipelineTransfer: () => ({
      readTable: async () => ({ columns: [], rows: [] }),
    }),
    downloadCsv: async () => ({ saved: false }),
    openCreateCompany: () => {},
    openCreateContact: () => {},
    copyPipelineLink: () => {},
  };
}
export function useCrmWorkspace() {
  return {
    activeTab,
    setActiveTab: navigate,
    searchText,
    setSearchText,
    stageFilter,
    setStageFilter,
    ownerFilter,
    setOwnerFilter,
    queryFilters,
    peopleVisibility: {
      canShowRemoved: () => false,
      showRemoved: () => false,
      setShowRemoved: () => {},
    },
    host: {
      scopeId: 'crm-member-access-fixture',
      isActive: () => true,
      focus: () => {},
      captureEntryState: () => {},
      openTeamSettings: () => {},
      settings: {
        isOpen: settingsOpen,
        open: () => setSettingsOpen(true),
        close: () => setSettingsOpen(false),
      },
      record: {
        records,
        section,
        commentTarget: () => undefined,
        item: () => undefined,
        open: setRecords,
        setSection,
        close: () => setRecords([]),
      },
    },
    soup: {
      focus: { set: () => {} },
      predicates: { set: () => {}, isActive: () => false, toggle: () => {} },
      grouping: { setActiveGroupId: () => {} },
      sort: { setAll: () => {} },
    },
    source: {},
  };
}
export const useCurrentTeamQuery = () => ({
  isSuccess: true,
  isError: false,
  data: params.has('no-team') ? null : { team: { id: 'team' } },
  refetch: async () => {},
});
export const useCrmLists = () => ({
  lists: () => [
    {
      id: 'private',
      name: 'Private collection',
      config: { companyIds: ['company'] },
    },
  ],
  query: { isLoading: false, isError: false },
});
export const useQuickAccessCrmCompaniesQuery = () => ({
  companies: () => [],
  query: { isLoading: false },
});
export function CrmRecordDetail(props: { navigation: JSX.Element }) {
  setRecordMounts((count) => count + 1);
  onCleanup(() => setRecordDisposals((count) => count + 1));
  return (
    <>
      <ViewShell.Header>{props.navigation}</ViewShell.Header>
      <p class="p-6">Private record detail</p>
    </>
  );
}
export const CrmActivityView = () => <p>Activity content</p>;
export const Crm = () => <p>In-workspace CRM settings</p>;
export const CrmItemDetail = () => null;
export const CrmExport = () => null;
export const CrmImport = () => null;
export const CompanyDisplayMenu = () => null;
export const CompanyViewsMenu = () => null;
export const ConnectorImportSidebar = () => null;
export const MobileFilterDrawer = () => null;
export const SoupActiveFiltersBar = () => null;
export const SoupFiltersBar = () => null;
export const SoupViewContextGroup = () => null;
export const SoupViewContextSort = () => null;
export const UnifiedFilterDropdown = () => null;
export const useFilterRefinements = () => ({
  consolidatedFiltersList: () => [],
});
