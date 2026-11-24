import {
  Company,
  type CompanySection,
  CompanyTabs,
  CompanyVisibilityButton,
} from '@app/features/crm/crm-company';
import { CrmCopyLinkButton } from '@app/features/crm/crm-link';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { CollapsibleHeaderItem } from '@components/app/split-layout/components/CollapsibleItem';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useEntryState } from '@components/app/split-layout/entry-state';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import {
  createParamsState,
  ParamsProvider,
} from '@core/component/ParamsProvider';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { crmAccessAllowed } from '@service-storage/crm-access-authority';
import { Show } from 'solid-js';

/**
 * Legacy adapter: bridges the block/split-layout system to the standalone
 * `companies` feature package. All block-specific glue lives here; the
 * `companies` package itself has zero block dependencies.
 */
export function CompanyBlockAdapter() {
  const companyId = useBlockId();
  const params = createParamsState();
  const [section, setSection] = useEntryState<CompanySection>(
    `crm.recordSection:company:${companyId}`,
    { default: 'overview' }
  );
  const panel = useSplitPanelOrThrow();
  const chooseSection = (next: CompanySection) => {
    setSection(next);
    // Opening a file swaps this block out without leaving its history
    // entry, which is when entry state is otherwise captured.
    panel.handle.captureEntryState();
  };
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: params.navigate,
  });
  return (
    <>
      <Show when={crmAccessAllowed()}>
        <SplitHeaderLeft>
          <CollapsibleHeaderItem
            id="company-tabs"
            priority={1}
            containerClass="ph-no-capture min-w-0 h-full mx-2 touch:mx-0"
          >
            {(isCollapsed) => (
              <div
                class={
                  isCollapsed()
                    ? 'min-w-0 not-touch:overflow-x-auto not-touch:scrollbar-hidden'
                    : 'shrink-0'
                }
              >
                <CompanyTabs
                  value={section()}
                  onChange={chooseSection}
                  compact={isCollapsed()}
                />
              </div>
            )}
          </CollapsibleHeaderItem>
        </SplitHeaderLeft>
        <SplitHeaderRight>
          <HeaderIsland class="p-0">
            <HeaderActionGroup label="Company actions">
              <CrmCopyLinkButton grouped type="company" id={companyId} />
              <CompanyVisibilityButton grouped companyId={companyId} />
            </HeaderActionGroup>
          </HeaderIsland>
        </SplitHeaderRight>
      </Show>
      <ParamsProvider state={params}>
        <Company companyId={companyId} section={section()} />
      </ParamsProvider>
    </>
  );
}
