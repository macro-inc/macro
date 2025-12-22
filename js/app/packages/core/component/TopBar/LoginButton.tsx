import { useIsAuthenticated } from '@core/auth';
import { useNavigate } from '@solidjs/router';
import { DeprecatedButton } from '../FormControls/DeprecatedButton';

export function openLoginModal() {
  const isAuthenticated = useIsAuthenticated();
  if (isAuthenticated()) return;

  window.location.href = `${window.location.origin}/app/login`;
}

export function LoginButton() {
  const navigate = useNavigate();
  return (
    <div class="flex gap-2 justify-center w-max items-baseline font-mono">
      <DeprecatedButton onClick={() => navigate('/login')}>
        Login
      </DeprecatedButton>
      <span class="italic">or</span>
      <DeprecatedButton onClick={() => navigate('/signup')}>
        Sign Up
      </DeprecatedButton>
    </div>
  );
}
