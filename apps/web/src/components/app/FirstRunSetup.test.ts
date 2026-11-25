/** @vitest-environment jsdom */
import { okAsync } from 'neverthrow';
import { batch, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFirstRunSetup } from './FirstRunSetup';

type User = {
  authenticated: true;
  id: string;
  tutorialComplete: boolean;
  isAgent: boolean;
};

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  nativeMobile: false,
  user: (): unknown => undefined,
  succeeded: (): boolean => false,
  onNavigate: () => {},
}));

vi.mock('@queries/auth/user-info', () => ({
  useUserInfoQuery: () => ({
    get isSuccess() {
      return mocks.succeeded();
    },
    get data() {
      // A real query suspends the app chrome on this read while pending.
      if (mocks.user() === undefined) mocks.calls.push('pending data read');
      return mocks.user();
    },
  }),
}));
vi.mock('@core/email-link', () => ({
  initAndStartEmailSync: () => {
    mocks.calls.push('email sync');
    return okAsync(undefined);
  },
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => mocks.nativeMobile,
}));
vi.mock('@solidjs/router', () => ({
  useNavigate: () => (to: string) => {
    mocks.calls.push(`navigate ${to}`);
    mocks.onNavigate();
  },
  useLocation: () => ({ pathname: '/app/mail', search: '' }),
}));

const NEW_USER: User = {
  authenticated: true,
  id: 'new-user',
  tutorialComplete: false,
  isAgent: false,
};

let dispose: (() => void) | undefined;

/**
 * Mounts the hook as the app chrome does, and signs `user` in. With
 * `succeeded: false` the user read has failed but still holds `user`, as a
 * failed refresh of a cached read does.
 */
function arrive(user: User, { succeeded = true } = {}) {
  const [current, setCurrent] = createSignal<User | undefined>(undefined);
  const [success, setSuccess] = createSignal(false);
  mocks.user = current;
  mocks.succeeded = success;
  createRoot((cleanup) => {
    dispose = cleanup;
    useFirstRunSetup();
  });
  batch(() => {
    setCurrent(user);
    setSuccess(succeeded);
  });
  return setCurrent;
}

beforeEach(() => {
  mocks.calls = [];
  mocks.nativeMobile = false;
  mocks.onNavigate = () => {};
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it('starts a new web user’s email sync before sending them to onboarding', () => {
  // Onboarding renders outside the app chrome: the navigation tears down
  // whatever the chrome had not started yet.
  mocks.onNavigate = () => dispose?.();

  arrive(NEW_USER);

  expect(mocks.calls).toEqual([
    'email sync',
    'navigate /onboarding?next=%2Fmail',
  ]);
});

it('starts a native app user’s email sync without sending them to onboarding', () => {
  mocks.nativeMobile = true;

  arrive(NEW_USER);

  expect(mocks.calls).toEqual(['email sync']);
});

it('sends a new agent to its setup page without starting email sync', () => {
  arrive({ ...NEW_USER, isAgent: true });

  expect(mocks.calls).toEqual(['navigate /agent-setup']);
});

it('waits for a successful user read, even with a cached first-run user', () => {
  arrive(NEW_USER, { succeeded: false });

  expect(mocks.calls).toEqual([]);
});

it('leaves a user who finished onboarding alone', () => {
  arrive({ ...NEW_USER, tutorialComplete: true });

  expect(mocks.calls).toEqual([]);
});

it('starts email sync once per user, and again for a different user', () => {
  mocks.nativeMobile = true;
  const signIn = arrive(NEW_USER);

  signIn({ ...NEW_USER });
  signIn({ ...NEW_USER, id: 'next-user' });

  expect(mocks.calls).toEqual(['email sync', 'email sync']);
});

it('starts a web user’s email sync once when the effect runs again', () => {
  const signIn = arrive(NEW_USER);

  signIn({ ...NEW_USER });

  expect(mocks.calls.filter((call) => call === 'email sync')).toEqual([
    'email sync',
  ]);
});
