import Caution from '@icon/regular/warning.svg';
import { Button } from '@ui/components/Button';
import { useLogout } from '@core/auth/logout';

export function EmailPermissionsBanner() {
  const logout = useLogout();

  return (
    <div class="w-full bg-alert-bg border-b border-t border-alert/20 text-alert-ink p-2">
      <div class="flex items-center justify-between gap-2">
        <Caution class="size-4" />
        <span class="text-sm">
          Email requires additional Google permissions. Select the permissions
          on sign-in to enable.
        </span>
        <span class="grow" />
        <Button variant="base" size="sm" class="px-2" onClick={() => logout()}>
          Logout
        </Button>
      </div>
    </div>
  );
}
