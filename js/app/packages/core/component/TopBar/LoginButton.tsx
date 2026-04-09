import { useIsAuthenticated } from '@core/auth';
import { useNavigate } from '@solidjs/router';
import { Button } from '@ui/components/Button';

export function openLoginModal() {
  const isAuthenticated = useIsAuthenticated();
  if (isAuthenticated()) return;

  const params = new URLSearchParams(window.location.search);
  const queryString = params.size > 0 ? `?${params.toString()}` : '';
  window.location.href = `${window.location.origin}/app/login${queryString}`;
}

export function LoginButton() {
  const navigate = useNavigate();
  return (
    <div class="flex gap-2 justify-center w-max items-center">
      <Button
        variant="secondary"
        size="sm"
        class="rounded-xs"
        onClick={() => navigate(`/login${window.location.search}`)}
      >
        Login
      </Button>
      <span class="text-xs text-ink-muted italic">or</span>
      <Button
        variant="accent"
        size="sm"
        class="rounded-xs"
        onClick={() => navigate(`/welcome${window.location.search}`)}
      >
        Sign Up
      </Button>
    </div>
  );
}
