import type { ComponentProps } from 'solid-js';
import { CrmProvider } from './context/crm-context';
import { createAppCrmContext } from './crm-adapter';
import { Company as View } from './views/company-detail';
export function Company(props: ComponentProps<typeof View>) {
  return (
    <CrmProvider value={createAppCrmContext()}>
      <View {...props} />
    </CrmProvider>
  );
}
