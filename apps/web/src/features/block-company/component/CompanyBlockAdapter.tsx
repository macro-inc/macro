import { Company } from '@companies/Company/Company';
import { useBlockId } from '@core/block';

/**
 * Legacy adapter: bridges the block/split-layout system to the standalone
 * `companies` feature package. All block-specific glue lives here; the
 * `companies` package itself has zero block dependencies.
 */
export function CompanyBlockAdapter() {
  const companyId = useBlockId();
  return <Company companyId={companyId} />;
}
