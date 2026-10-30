import type { Link as EmailLink } from '@service-email/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { onlineManager } from '@tanstack/query-core';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, type Ok, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInboxEmail } from './inbox-email';
import { emailKeys } from './keys';

const getLinksMock = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: { getLinks: getLinksMock },
}));
vi.mock('@queries/calendar/sync', () => ({ invalidateCalendarViews: vi.fn() }));
vi.mock('@queries/auth/user-info', () => ({ invalidateUserInfo: vi.fn() }));
vi.mock('@queries/soup/normalized-cache', () => ({
  invalidateAllSoup: vi.fn(),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'login@macro.com',
  useIsAuthenticated: () => () => true,
}));

let client: QueryClient;
vi.mock('../client', () => ({
  get queryClient() {
    return client;
  },
}));

const outlook = {
  id: 'outlook',
  email_address: 'owner@tenant.example.com',
} as unknown as EmailLink;

function Viewer(props: { linkId: () => string | undefined }) {
  const viewer = useInboxEmail(props.linkId);
  return <output>{viewer() ?? 'unknown'}</output>;
}

const mount = (linkId: string | undefined) => {
  const [id, setId] = createSignal(linkId);
  render(() => (
    <QueryClientProvider client={client}>
      <Viewer linkId={id} />
    </QueryClientProvider>
  ));
  return { viewer: () => screen.getByRole('status').textContent, setId };
};

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  client.clear();
  vi.clearAllMocks();
});

describe('useInboxEmail', () => {
  it("is the owning inbox's address once inboxes load", async () => {
    getLinksMock.mockResolvedValue(ok({ links: [outlook] }));
    const { viewer } = mount('outlook');
    await vi.waitFor(() => expect(viewer()).toBe('owner@tenant.example.com'));
  });

  it('is unknown while inboxes are still loading', async () => {
    const request = Promise.withResolvers<Ok<{ links: EmailLink[] }, never>>();
    getLinksMock.mockReturnValue(request.promise);
    const { viewer } = mount('outlook');
    await vi.waitFor(() => expect(getLinksMock).toHaveBeenCalledOnce());
    expect(viewer()).toBe('unknown');
    request.resolve(ok({ links: [outlook] }));
    await vi.waitFor(() => expect(viewer()).toBe('owner@tenant.example.com'));
  });

  it('is unknown, not the Macro login, while offline with no cached inboxes', async () => {
    onlineManager.setOnline(false);
    getLinksMock.mockResolvedValue(ok({ links: [outlook] }));
    const { viewer } = mount('outlook');
    expect(viewer()).toBe('unknown');
    expect(getLinksMock).not.toHaveBeenCalled();
    onlineManager.setOnline(true);
    await vi.waitFor(() => expect(viewer()).toBe('owner@tenant.example.com'));
  });

  it('is unknown, not the Macro login, when the inbox list fails to load', async () => {
    getLinksMock.mockResolvedValue(
      err([{ code: 'HTTP_ERROR' as const, message: 'unavailable' }])
    );
    const { viewer } = mount('outlook');
    await vi.waitFor(() => expect(getLinksMock).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(client.getQueryState(emailKeys.links.queryKey)?.status).toBe(
        'error'
      )
    );
    expect(viewer()).toBe('unknown');
  });

  it('keeps the address when a later inbox refresh fails', async () => {
    getLinksMock.mockResolvedValueOnce(ok({ links: [outlook] }));
    const { viewer } = mount('outlook');
    await vi.waitFor(() => expect(viewer()).toBe('owner@tenant.example.com'));
    getLinksMock.mockResolvedValue(
      err([{ code: 'HTTP_ERROR' as const, message: 'unavailable' }])
    );
    await client.refetchQueries({ queryKey: emailKeys.links.queryKey });
    expect(client.getQueryState(emailKeys.links.queryKey)?.status).toBe(
      'error'
    );
    expect(viewer()).toBe('owner@tenant.example.com');
  });

  it("is unknown until the mail's inbox is known, then follows it", async () => {
    getLinksMock.mockResolvedValue(ok({ links: [outlook] }));
    const { viewer, setId } = mount(undefined);
    await vi.waitFor(() => expect(getLinksMock).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(client.getQueryState(emailKeys.links.queryKey)?.status).toBe(
        'success'
      )
    );
    expect(viewer()).toBe('unknown');
    setId('outlook');
    expect(viewer()).toBe('owner@tenant.example.com');
  });

  it("is unknown for an inbox that is not one of the user's", async () => {
    getLinksMock.mockResolvedValue(ok({ links: [outlook] }));
    const { viewer } = mount('shared-inbox');
    await vi.waitFor(() =>
      expect(client.getQueryState(emailKeys.links.queryKey)?.status).toBe(
        'success'
      )
    );
    expect(viewer()).toBe('unknown');
  });
});
