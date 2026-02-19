import { hasPermissions, Permissions } from '@core/component/SharePermissions';
import type { ParentProps } from 'solid-js';
import { useEmailContext } from './EmailContext';
import { EmailPropertiesDrawer } from './EmailPropertiesModal';

export function ModalsMounter(props: ParentProps<{ subject?: string }>) {
  const email = useEmailContext();
  const canEdit = () =>
    hasPermissions(email.permissions().type, Permissions.CAN_EDIT);
  return (
    <>
      {props.children}
      <EmailPropertiesDrawer canEdit={canEdit()} subject={props.subject} />
    </>
  );
}
