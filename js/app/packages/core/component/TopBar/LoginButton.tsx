import { useIsAuthenticated } from '@core/auth';
import { useNavigate } from '@solidjs/router';
import { Button } from '../FormControls/Button';

export function openLoginModal() {
  const isAuthenticated = useIsAuthenticated();
  if (isAuthenticated()) return;

  window.location.href = `${window.location.origin}/app/login`;
}

export function LoginButton() {
  const navigate = useNavigate();
  return (
    <div class="flex gap-2 justify-center w-max items-baseline font-mono">
      <Button onClick={() => navigate('/login')}>Login</Button>
      <span class="italic">or</span>
      <Button onClick={() => navigate('/signup')}>Sign Up</Button>
    </div>
  );
}
