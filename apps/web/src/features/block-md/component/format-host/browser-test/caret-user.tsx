// C-TOUCH-CARET-MODE-01 part B (v11): the ONE user context both caret pages
// mount, the app's real UserContextProvider (Root.tsx wraps the whole app in
// it), over its own QueryClient seeded with a fixed local fixture user. The
// user-info query stays disabled (no login cookie on the fixture host,
// user-info-gate.ts), so nothing is fetched and no real account is used.
import { UserContextProvider } from '@core/context/user';
import { authKeys } from '@queries/auth/keys';
import type { UserInfoData } from '@queries/auth/user-info';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { JSX } from 'solid-js';

/** The fixed local fixture user (the shape authServiceClient maps to). */
export const caretFixtureUser = {
  id: 'macro|caret-fixture-user',
  userId: 'macro|caret-fixture-user',
  authenticated: true,
  permissions: [],
  email: 'caret-fixture@example.invalid',
  name: 'Caret Fixture',
  licenseStatus: 'none',
  tutorialComplete: true,
  isAgent: false,
  group: undefined,
  hasChromeExt: false,
  hasTrialed: false,
  aiDataConsent: false,
  referralCode: '',
  createdAt: undefined,
} satisfies UserInfoData;

export function CaretUserProvider(props: { children: JSX.Element }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  client.setQueryData(authKeys.userInfo.queryKey, caretFixtureUser);
  return (
    <QueryClientProvider client={client}>
      <UserContextProvider>{props.children}</UserContextProvider>
    </QueryClientProvider>
  );
}
