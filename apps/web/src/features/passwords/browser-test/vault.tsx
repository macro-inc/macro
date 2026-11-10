import '@app/index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { HashRouter, Route, Router, useLocation } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err } from 'neverthrow';
import { render } from 'solid-js/web';
import { requiresReauthentication } from '../../auth/core/reauthentication';
import { PasswordsProvider } from '../context/passwords-context';
import { createFakePasswordSource } from '../tests/fake-source';
import { VaultView } from '../views/vault-view';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
const query = new URLSearchParams(window.location.search);
const source = createFakePasswordSource();
if (query.has('reauth')) source.reveal = async () => err('reauth');
const nativeRouting = query.has('native');
// Match the production web router's base without reloading the fixture.
if (!nativeRouting && !window.location.pathname.startsWith('/app/')) {
  window.history.replaceState(
    null,
    '',
    `/app${window.location.pathname}${window.location.search}${window.location.hash}`
  );
}
const View = () => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <PasswordsProvider
      value={{
        source,
        recipients: () => [
          { id: 'fixture-person', name: 'Avery Lee', kind: 'user' },
          { id: 'fixture-team', name: 'Product team', kind: 'team' },
        ],
        recipientsLoading: () => false,
        recipientsError: () => false,
        writeClipboard: async (value) => {
          document.body.dataset.copied = value;
        },
      }}
    >
      <div class="h-dvh">
        <VaultView teamId="fixture-team" />
      </div>
    </PasswordsProvider>
  </QueryClientProvider>
);
const Login = () => {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  return (
    <output data-testid="login-intent">{`${requiresReauthentication(query)}:${query.get('redirect')}`}</output>
  );
};
render(
  () =>
    nativeRouting ? (
      <HashRouter>
        <Route path="/login" component={Login} />
        <Route path="/*all" component={View} />
      </HashRouter>
    ) : (
      <Router base="/app">
        <Route path="/login" component={Login} />
        <Route path="/*all" component={View} />
      </Router>
    ),
  root
);
