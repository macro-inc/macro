import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { SignInToRespond } from './sign-in-to-respond';

const mocks = vi.hoisted(() => ({
  setPostLoginRedirect: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@core/util/postLoginRedirect', () => ({
  setPostLoginRedirect: mocks.setPostLoginRedirect,
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));

afterEach(cleanup);

it('signs in, then comes back to the form it was answering', () => {
  window.history.replaceState(null, '', '/app/form/form-1/respond');
  render(() => <SignInToRespond>Sign in</SignInToRespond>);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(mocks.setPostLoginRedirect).toHaveBeenCalledWith(
    `${window.location.origin}/app/form/form-1/respond`
  );
  expect(mocks.navigate).toHaveBeenCalledWith('/login');
});
