import { useIsAuthenticated } from '@core/auth';
import { useEmail } from '@core/context/user';
import Lock from '@phosphor-icons/core/regular/lock.svg?component-solid';
import { EmptyStatePanel } from '@ui';
import { onMount } from 'solid-js';
import { openLoginModal } from '../TopBar/LoginButton';

/**
 * @description This is the view for when a user tries to access an item that returns a 401 indicating they do not have permission to access it.
 */
export default function Unauthorized() {
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
      graphic={Lock}
      title="You don't have access to this file"
      description={
        currentUserEmail()
          ? `Signed in as ${currentUserEmail()}. Ask the owner to share it with you.`
          : 'Ask the owner to share it with you.'
      }
    />
  );
}
