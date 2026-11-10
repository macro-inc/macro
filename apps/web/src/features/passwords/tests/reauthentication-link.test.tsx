import { HashRouter, Route, Router } from '@solidjs/router';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err } from 'neverthrow';
import { afterEach, expect, it } from 'vitest';
import {
  authenticationParams,
  requiresReauthentication,
} from '../../auth/core/reauthentication';
import { PasswordsProvider } from '../context/passwords-context';
import { VaultView } from '../views/vault-view';
import { createFakePasswordSource } from './fake-source';

afterEach(cleanup);
for (const native of [false, true]) {
  it(`keeps the fresh sign-in link inside the ${native ? 'native hash' : 'browser'} router`, async () => {
    window.history.replaceState(
      null,
      '',
      native ? '/#/passwords' : '/app/passwords'
    );
    const source = createFakePasswordSource();
    await source.save(
      undefined,
      undefined,
      {
        name: 'Credential',
        kind: 'login',
        url: '',
        folderId: null,
        favorite: false,
        values: {
          username: 'account',
          password: 'synthetic',
          notes: '',
          fields: [],
        },
      },
      '019a0000-0000-7000-8000-000000000001'
    );
    source.reveal = async () => err('reauth');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const View = () => (
      <QueryClientProvider client={client}>
        <PasswordsProvider
          value={{
            source,
            recipients: () => [],
            recipientsLoading: () => false,
            recipientsError: () => false,
            writeClipboard: async () => {},
          }}
        >
          <VaultView teamId="fixture-team" />
        </PasswordsProvider>
      </QueryClientProvider>
    );
    render(() =>
      native ? (
        <HashRouter>
          <Route path="/*all" component={View} />
        </HashRouter>
      ) : (
        <Router base="/app">
          <Route path="/*all" component={View} />
        </Router>
      )
    );
    fireEvent.click(await screen.findByRole('button', { name: /Credential/ }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Reveal password',
      })
    );
    const link = await screen.findByRole('link', { name: 'Sign in again' });
    const target = new URL(
      link.getAttribute('href') ?? '',
      window.location.href
    );
    expect(requiresReauthentication(target)).toBe(true);
    expect(authenticationParams(target).get('redirect')).toBe('/passwords');
    expect(native ? target.hash.split('?')[0] : target.pathname).toBe(
      native ? '#/login' : '/app/login'
    );
    client.clear();
  });
}
