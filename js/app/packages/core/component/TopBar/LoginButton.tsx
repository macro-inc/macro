import { useIsAuthenticated } from '@core/auth';
import { useNavigate } from '@solidjs/router';
import { DeprecatedButton } from '../FormControls/DeprecatedButton';

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
    <div class="flex gap-2 justify-center w-max items-baseline font-mono">
      <DeprecatedButton
        onClick={() => navigate(`/login${window.location.search}`)}
      >
        Login
      </DeprecatedButton>
      <span class="italic">or</span>
      <DeprecatedButton
        onClick={() => navigate(`/signup${window.location.search}`)}
      >
        Sign Up
      </DeprecatedButton>
    </div>
  );
}
