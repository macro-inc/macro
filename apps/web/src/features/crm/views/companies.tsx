import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show, Suspense } from 'solid-js';
import { MobileFilterDrawer } from '../../next-soup/soup-view/filters-bar/mobile-filter-drawer';
import { SoupFiltersBar } from '../../next-soup/soup-view/filters-bar/soup-filters-bar';
import { SoupViewList } from '../../next-soup/soup-view/soup-view';
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
          {/* People keeps the workspace title row and search on touch. */}
          <Show when={isTouchDevice() && !people()}>
            <div class="flex flex-col w-full">
              <SplitHeaderLeft>
                <div class="h-full flex gap-3 @max-[380px]/split-header:gap-2 items-center w-full flex-1 min-w-0">
                  <div class="pointer-events-auto flex shrink-0 items-center gap-2">
                    {options.mobileHeaderLeading}
                    <MobileFilterDrawer />
                  </div>
                </div>
              </SplitHeaderLeft>
            </div>
            <SoupFiltersBar />
          </Show>
          <div class="relative grow min-h-1 flex max-sm:flex-col flex-row size-full">
            <Suspense>
              <Show
                when={people()}
                fallback={
                  <SoupViewList
                    emptyContent={<CrmEmptyState />}
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
                  emptyContent={<CrmEmptyState />}
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
