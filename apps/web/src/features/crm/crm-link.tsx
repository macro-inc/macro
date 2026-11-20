import { CrmProvider } from './context/crm-context';
import { createAppCrmContext } from './crm-adapter';
import { CrmCopyLinkButton as View } from './views/copy-link-button';
import { RecordAskMacroButton } from './views/record-ask-macro-button';
export function CrmCopyLinkButton(props: {
  type: 'company' | 'contact';
  id: string;
  grouped?: boolean;
}) {
  return (
    <CrmProvider value={createAppCrmContext()}>
      <View {...props} />
    </CrmProvider>
  );
}

/** Ask Macro about a company or contact, for a host's top bar. */
export function CrmAskMacroButton(props: {
  type: 'company' | 'contact';
  id: string;
  grouped?: boolean;
}) {
  return (
    <CrmProvider value={createAppCrmContext()}>
      <RecordAskMacroButton
        grouped={props.grouped}
        record={{ type: props.type, id: props.id }}
      />
    </CrmProvider>
  );
}
