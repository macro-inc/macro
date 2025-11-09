import { useIsAuthenticated } from '@core/auth';
import Lock from '@phosphor-icons/core/regular/lock.svg?component-solid';
import { useEmail } from '@service-gql/client';
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
    <div class="flex flex-col items-center justify-center h-full space-y-4">
      <div class="rounded-full">
        <Lock class="w-10 h-10" />
      </div>
      <p class="text-ink-muted text-nowrap">
        You {currentUserEmail() ? `(${currentUserEmail()})` : ''} do not have
        permission to view this file.
      </p>
      <span class="text-accent-ink">401</span>
    </div>
  );
}
