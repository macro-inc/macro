import {
  Company,
  type CompanySection,
  CompanyTabs,
} from '@app/features/crm/crm-company';
import { CrmCopyLinkButton } from '@app/features/crm/crm-link';
import { CollapsibleHeaderItem } from '@components/app/split-layout/components/CollapsibleItem';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useBlockId } from '@core/block';
import {
  createParamsState,
  ParamsProvider,
} from '@core/component/ParamsProvider';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { createSignal } from 'solid-js';

/**
 * Legacy adapter: bridges the block/split-layout system to the standalone
 * `companies` feature package. All block-specific glue lives here; the
 * `companies` package itself has zero block dependencies.
 */
export function CompanyBlockAdapter() {
  const companyId = useBlockId();
  const params = createParamsState();
  const [section, setSection] = createSignal<CompanySection>('overview');
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: params.navigate,
  });
  return (
    <>
      <SplitHeaderLeft>
        <CollapsibleHeaderItem
          id="company-tabs"
          priority={1}
          containerClass="ph-no-capture min-w-0 h-full mx-2"
        >
          {(isCollapsed) => (
            // Labels keep their width so the header collapses them to
            // icons; the icons scroll once even they no longer fit.
            <div
              class={
                isCollapsed()
                  ? 'min-w-0 overflow-x-auto scrollbar-hidden'
                  : 'shrink-0'
              }
            >
              <CompanyTabs
                value={section()}
                onChange={setSection}
                compact={isCollapsed()}
              />
            </div>
          )}
        </CollapsibleHeaderItem>
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <HeaderIsland>
          <CrmCopyLinkButton type="company" id={companyId} />
        </HeaderIsland>
      </SplitHeaderRight>
      <ParamsProvider state={params}>
        <Company companyId={companyId} section={section()} />
      </ParamsProvider>
    </>
  );
}
