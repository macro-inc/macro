import { Company } from '@companies/Company/Company';
import { CrmCopyLinkButton } from '@companies/components/CrmCopyLinkButton';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { useBlockId } from '@core/block';

/**
 * Legacy adapter: bridges the block/split-layout system to the standalone
 * `companies` feature package. All block-specific glue lives here; the
 * `companies` package itself has zero block dependencies.
 */
export function CompanyBlockAdapter() {
  const companyId = useBlockId();
  return (
    <>
      <SplitHeaderRight>
        <HeaderIsland>
          <CrmCopyLinkButton type="company" id={companyId} />
        </HeaderIsland>
      </SplitHeaderRight>
      <Company companyId={companyId} />
    </>
  );
}
