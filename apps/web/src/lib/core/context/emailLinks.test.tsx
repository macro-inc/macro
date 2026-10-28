/**
 * @vitest-environment jsdom
 */

import type { Link } from '@service-email/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { onlineManager } from '@tanstack/query-core';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailLinksContextProvider, useEmailLinksContext } from './emailLinks';

const mocks = vi.hoisted(() => ({
  useEmailLinksQuery: vi.fn(),
  useIsAuthenticated: vi.fn(),
}));

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: mocks.useEmailLinksQuery,
}));

vi.mock('./user', () => ({
  useIsAuthenticated: mocks.useIsAuthenticated,
}));

function Consumer(props: { label: string }) {
  const { links, isConnectedSecondaryInbox } = useEmailLinksContext();
  return (
    <span>
      {props.label}:{links().length}:
      {String(isConnectedSecondaryInbox('macro|secondary@example.com'))}
    </span>
  );
}

beforeEach(() => {
  mocks.useEmailLinksQuery.mockReset();
  mocks.useIsAuthenticated.mockReset();
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe('EmailLinksContext', () => {
  it.each(['fetching', 'paused'] as const)(
    'renders cached mail while inbox identity metadata is %s',
    async (status) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const request = Promise.withResolvers<{ links: Link[] }>();
      const started = Promise.withResolvers<void>();
      const fetchLinks = vi.fn(() => {
        started.resolve();
        return request.promise;
      });
      mocks.useIsAuthenticated.mockReturnValue(() => true);
      mocks.useEmailLinksQuery.mockImplementation(() =>
        useQuery(() => ({ queryKey: ['links'], queryFn: fetchLinks }))
      );
      onlineManager.setOnline(status !== 'paused');
      render(() => (
        <QueryClientProvider client={client}>
          <EmailLinksContextProvider>
            <Suspense fallback={<span>Hidden mail</span>}>
              <Consumer label="cached row" />
            </Suspense>
          </EmailLinksContextProvider>
        </QueryClientProvider>
      ));

      if (status === 'fetching') await started.promise;
      expect(screen.queryByText('Hidden mail')).toBeNull();
      const row = screen.getByText('cached row:0:false');
      onlineManager.setOnline(true);
      await started.promise;
      request.resolve({ links: [] });
      await client.refetchQueries();
      expect(client.getQueryState(['links'])?.status).toBe('success');
      expect(screen.getByText('cached row:0:false')).toBe(row);
      client.clear();
    }
  );

  it('shares reactive identity metadata across consumers', () => {
    const [authenticated, setAuthenticated] = createSignal(true);
    const [data] = createSignal({
      links: [
        {
          id: 'secondary-inbox',
          email_address: 'secondary@example.com',
          is_primary: false,
        } as Link,
      ],
    });
    let queryEnabled: (() => boolean) | undefined;

    mocks.useIsAuthenticated.mockReturnValue(authenticated);
    mocks.useEmailLinksQuery.mockImplementation((enabled) => {
      queryEnabled = enabled;
      return {
        get data() {
          return data();
        },
      };
    });

    render(() => (
      <EmailLinksContextProvider>
        <Consumer label="first" />
        <Consumer label="second" />
      </EmailLinksContextProvider>
    ));

    expect(screen.getByText('first:1:true')).toBeTruthy();
    expect(screen.getByText('second:1:true')).toBeTruthy();
    expect(mocks.useEmailLinksQuery).toHaveBeenCalledOnce();
    expect(queryEnabled?.()).toBe(true);

    setAuthenticated(false);

    expect(screen.getByText('first:0:false')).toBeTruthy();
    expect(screen.getByText('second:0:false')).toBeTruthy();
    expect(queryEnabled?.()).toBe(false);
  });
});
