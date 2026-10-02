import {
  Company,
  type CompanySection,
  CompanyTabs,
} from '@app/features/crm/crm-company';
import { CrmCopyLinkButton } from '@app/features/crm/crm-link';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
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
      <SplitHeaderRight>
        <HeaderIsland>
          <CrmCopyLinkButton type="company" id={companyId} />
        </HeaderIsland>
      </SplitHeaderRight>
      <ParamsProvider state={params}>
        <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
          <CompanyTabs value={section()} onChange={setSection} />
          <div class="relative min-h-0 min-w-0 flex-1">
            <Company companyId={companyId} section={section()} />
          </div>
        </div>
      </ParamsProvider>
    </>
  );
}
