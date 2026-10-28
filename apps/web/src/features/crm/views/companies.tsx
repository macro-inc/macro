import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show, Suspense } from 'solid-js';
import { SoupViewList } from '../../next-soup/soup-view/soup-view';
import { CrmListError, CrmListSkeleton } from '../components/list-state';
import { useCrmWorkspace } from '../context/workspace-context';
import { CompanyGroupHeader } from './company-group-header';
import { ResponsiveCompanyListHeader } from './company-list-header';
import { CompanyListEntity } from './company-row';
import { ResponsiveContactListHeader } from './contact-list-header';
import { ContactListEntity } from './contact-row';
import { CrmWorkspaceView } from './crm-workspace';
import { CrmEmptyState } from './empty-state';

export function Companies() {
  const view = useCrmWorkspace();
  const people = () => view.activeTab() === 'people';
  return (
    <CrmWorkspaceView>
      {(options) => (
        <div
          class="size-full flex flex-col @container"
          data-list-view="companies"
        >
          <div class="relative grow min-h-1 flex max-sm:flex-col flex-row size-full">
            <Suspense fallback={<CrmListSkeleton />}>
              <Show
                when={people()}
                fallback={
                  <SoupViewList
                    emptyState={(state) => (
                      <CrmEmptyState
                        filtered={state.filtered}
                        onClearFilters={state.clearFilters}
                        onClearPeopleSearch={options.clearPeopleSearch}
                        onEditList={options.editList}
                      />
                    )}
                    loadingContent={<CrmListSkeleton />}
                    errorContent={(retry) => (
                      <CrmListError onRetry={async () => retry()} />
                    )}
                    onOpenEntity={options.onOpenEntity}
                    rowEntry={{ component: CompanyListEntity, family: 'row' }}
                    groupHeader={CompanyGroupHeader}
                    listHeader={
                      <Show when={!isTouchDevice()}>
                        <ResponsiveCompanyListHeader class="shrink-0" />
                      </Show>
                    }
                  />
                }
              >
                <SoupViewList
                  emptyState={(state) => (
                    <CrmEmptyState
                      filtered={state.filtered}
                      onClearFilters={state.clearFilters}
                      onClearPeopleSearch={options.clearPeopleSearch}
                      onEditList={options.editList}
                    />
                  )}
                  loadingContent={<CrmListSkeleton />}
                  errorContent={(retry) => (
                    <CrmListError onRetry={async () => retry()} />
                  )}
                  onOpenEntity={options.onOpenEntity}
                  rowEntry={{ component: ContactListEntity, family: 'row' }}
                  listHeader={
                    <Show when={!isTouchDevice()}>
                      <ResponsiveContactListHeader class="shrink-0" />
                    </Show>
                  }
                />
              </Show>
            </Suspense>
          </div>
        </div>
      )}
    </CrmWorkspaceView>
  );
}
