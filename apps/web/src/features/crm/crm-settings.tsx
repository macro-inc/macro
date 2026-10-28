import type { ComponentProps } from 'solid-js';
import { CrmProvider } from './context/crm-context';
import { createAppCrmContext } from './crm-adapter';
import { Crm as View } from './views/crm-settings';
export function CrmSettings(props: ComponentProps<typeof View>) {
  return (
    <CrmProvider value={createAppCrmContext()}>
      <View {...props} />
    </CrmProvider>
  );
}
