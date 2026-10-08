import { PillTabs } from '@components/app/mobile/PillTabs';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { ENABLE_UNIFIED_LIST_AI_INPUT } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show, Suspense } from 'solid-js';
import { SoupChatInput } from '../../chat/SoupChatInput';
import { MobileFilterDrawer } from '../../next-soup/soup-view/filters-bar/mobile-filter-drawer';
import { SoupFiltersBar } from '../../next-soup/soup-view/filters-bar/soup-filters-bar';
import { SoupViewList } from '../../next-soup/soup-view/soup-view';
import { MaybeSoupEntityActionDrawerManager } from '../../soup';
import { useCrmWorkspace } from '../context/workspace-context';
import { CompanyKanban } from './company-board';
import { CompanyGroupHeader } from './company-group-header';
import { ResponsiveCompanyListHeader } from './company-list-header';
import { CompanyListEntity } from './company-row';
import { CrmWorkspaceView } from './crm-workspace';
import { CrmEmptyState } from './empty-state';
import { useCrmUnavailable } from './use-crm';

export function Companies() {
  const view = useCrmWorkspace();
  const unavailable = useCrmUnavailable();
  return (
    <CrmWorkspaceView>
      {(options) => (
        <div
          class="size-full flex flex-col @container"
          data-list-view="companies"
        >
          <Show when={isTouchDevice()}>
            <div class="flex flex-col w-full">
              <SplitHeaderLeft>
                <div class="h-full flex gap-3 @max-[380px]/split-header:gap-2 items-center w-full flex-1 min-w-0">
                  <PillTabs
                    scrollable
                    class="-ml-(--mobile-chrome-gutter) w-[100cqw] max-w-none flex-none"
                    contentClass="px-(--mobile-chrome-gutter)"
                    leading={
                      <>
                        {options.mobileHeaderLeading}
                        <MobileFilterDrawer />
                      </>
                    }
                    items={[
                      { value: 'board', label: 'Board' },
                      { value: 'list', label: 'List' },
                    ]}
                    value={view.viewMode()}
                    onChange={(value) =>
                      view.setViewMode(value as 'list' | 'board')
                    }
                  />
                </div>
              </SplitHeaderLeft>
            </div>
            <SoupFiltersBar />
          </Show>
          <div class="relative grow min-h-1 flex max-sm:flex-col flex-row size-full">
            <Suspense>
              <Show
                when={view.viewMode() !== 'board'}
                fallback={
                  <MaybeSoupEntityActionDrawerManager>
                    <CompanyKanban onOpenEntity={options.onOpenEntity} />
                  </MaybeSoupEntityActionDrawerManager>
                }
              >
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
              </Show>
            </Suspense>
          </div>
          <Suspense>
            <Show
              when={
                !isTouchDevice() &&
                ENABLE_UNIFIED_LIST_AI_INPUT &&
                (view.viewMode() !== 'board' || unavailable())
              }
            >
              <div class="absolute bottom-0 inset-x-px pb-2.5 px-2 flex justify-center pointer-events-none">
                <div class="pointer-events-auto w-full min-w-0 max-w-3xl">
                  <SoupChatInput />
                </div>
              </div>
            </Show>
          </Suspense>
        </div>
      )}
    </CrmWorkspaceView>
  );
}
