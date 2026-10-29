import { useIsAuthenticated } from '@core/auth';
import { useEmail } from '@core/context/user';
import NoAccessGraphic from '@design/empty-state-no-access.svg';
import { EmptyStatePanel } from '@ui';
import { onMount, type ParentProps } from 'solid-js';
import { openLoginModal } from '../TopBar/LoginButton';

/**
 * @description This is the view for when a user tries to access an item that returns a 401 indicating they do not have permission to access it.
 * `noun` names the item when it is not a file, such as an event.
 */
export default function Unauthorized(props: ParentProps<{ noun?: string }>) {
  const currentUserEmail = useEmail();

  const isAuthenticated = useIsAuthenticated();
  onMount(() => {
    if (!isAuthenticated()) {
      openLoginModal();
    }
  });

  return (
    <EmptyStatePanel
      centered
      graphic={NoAccessGraphic}
      graphicClass="mb-6"
      title={`You don't have access to this ${props.noun ?? 'file'}`}
      description={
        currentUserEmail() ? `Signed in as ${currentUserEmail()}` : undefined
      }
    >
      {props.children}
    </EmptyStatePanel>
  );
}
