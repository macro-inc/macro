import { CrmProvider } from './context/crm-context';
import { createAppCrmContext } from './crm-adapter';
import { CrmCopyLinkButton as View } from './views/copy-link-button';
export function CrmCopyLinkButton(props: {
  type: 'company' | 'contact';
  id: string;
}) {
  return (
    <CrmProvider value={createAppCrmContext()}>
      <View {...props} />
    </CrmProvider>
  );
}
