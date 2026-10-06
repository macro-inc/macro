import type { ComponentProps } from 'solid-js';
import { RecordTabs } from './components/record-tabs';
import { CrmProvider } from './context/crm-context';
import { COMPANY_SECTIONS, type CompanySection } from './core/record';
import { createAppCrmContext } from './crm-adapter';
import { Company as View } from './views/company-detail';

export type { CompanySection } from './core/record';

export function Company(props: ComponentProps<typeof View>) {
  return (
    <CrmProvider value={createAppCrmContext()}>
      <View {...props} />
    </CrmProvider>
  );
}

/** The company's section tabs, below a host's header. */
export function CompanyTabs(props: {
  value: CompanySection;
  onChange: (section: CompanySection) => void;
}) {
  return <RecordTabs sections={COMPANY_SECTIONS} {...props} />;
}
