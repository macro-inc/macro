import type { ComponentProps } from 'solid-js';
import { CrmProvider } from './context/crm-context';
import { createAppCrmContext } from './crm-adapter';
import { Contact as View } from './views/contact-detail';
export function Contact(props: ComponentProps<typeof View>) {
  return (
    <CrmProvider value={createAppCrmContext()}>
      <View {...props} />
    </CrmProvider>
  );
}
