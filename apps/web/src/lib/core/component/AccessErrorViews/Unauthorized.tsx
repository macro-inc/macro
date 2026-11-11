import { useIsAuthenticated } from '@core/auth';
import { useEmail } from '@core/context/user';
import NoAccessGraphic from '@design/empty-state-no-access.svg';
import { EmptyStatePanel } from '@ui';
import { onMount, type ParentProps, Show } from 'solid-js';
import { openLoginModal } from '../TopBar/LoginButton';

/**
 * @description This is the view for when a user tries to access an item that returns a 401 indicating they do not have permission to access it.
 * `noun` names the item when it is not a file, such as an event.
 * `compact` is the mention preview card: title and signed-in line only, so a
 * phone sheet does not stretch to the full-page empty state.
 */
export default function Unauthorized(
  props: ParentProps<{ noun?: string; compact?: boolean }>
) {
  const currentUserEmail = useEmail();

  const isAuthenticated = useIsAuthenticated();
  onMount(() => {
    if (!isAuthenticated()) {
      openLoginModal();
    }
  });

  const title = () => `You don't have access to this ${props.noun ?? 'file'}`;
  const description = () =>
    currentUserEmail() ? `Signed in as ${currentUserEmail()}` : undefined;

  return (
    <Show
      when={!props.compact}
      fallback={
        <div
          data-unauthorized-compact
          class="flex flex-col items-center py-6 text-center"
        >
          <h2 class="text-base font-semibold text-ink">{title()}</h2>
          <Show when={description()}>
            {(signedIn) => (
              <p class="mt-3 text-sm/6 text-ink-muted">{signedIn()}</p>
            )}
          </Show>
          {props.children}
        </div>
      }
    >
      <EmptyStatePanel
        centered
        graphic={NoAccessGraphic}
        graphicClass="mb-6"
        title={title()}
        description={description()}
      >
        {props.children}
      </EmptyStatePanel>
    </Show>
  );
}
