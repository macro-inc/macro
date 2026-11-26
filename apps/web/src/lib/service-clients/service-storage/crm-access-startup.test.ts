import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import { beforeEach, expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => ({
  native: false,
  hint: {
    identity: 'profile',
    account: 'viewer',
    generation: '00000000-0000-4000-8000-000000000002',
    policy: '00000000-0000-4000-8000-000000000001:allowed',
    ready: true,
  } satisfies CacheAuthority,
}));
vi.mock('@core/util/platform', async (actual) => ({
  ...(await actual<typeof import('@core/util/platform')>()),
  isTauri: () => startup.native,
}));
vi.mock('@graphql-cache/generation-mirror', () => ({
  startupAuthorityHint: startup.hint,
}));

beforeEach(() => {
  vi.resetModules();
  startup.native = false;
});

it.each([
  ['00000000-0000-4000-8000-000000000001:denied', false, 'denied'],
  ['00000000-0000-4000-8000-000000000001:allowed', false, 'pending'],
  ['00000000-0000-4000-8000-000000000001:allowed', true, 'allowed'],
] as const)(
  'keeps native CRM closed until its local owner reports %s, ready=%s',
  async (policy, ready, expected) => {
    startup.native = true;
    const { crmAccessAuthority, configureCrmAccessAuthority } = await import(
      './crm-access-authority'
    );
    const local = Promise.withResolvers<CacheAuthority>();
    const owner: CacheAuthorityHost = {
      current: () => local.promise,
      snapshot: () => undefined,
      onChanged: () => () => {},
      transition: vi.fn<CacheAuthorityHost['transition']>(),
    };
    const fetchProof = vi.fn(async () => policy);
    configureCrmAccessAuthority({ fetchProof, retire: async () => {} });
    crmAccessAuthority.setHost(owner);
    crmAccessAuthority.setSession('viewer');
    const initializing = crmAccessAuthority.initialize();

    // Native company/contact email lists can restore their REST pages from
    // IDB before the shared owner finishes an interrupted denial retirement.
    expect(crmAccessAuthority.state()).toBe('pending');
    expect(crmAccessAuthority.allowed()).toBe(false);

    local.resolve({
      ...startup.hint,
      generation: '00000000-0000-4000-8000-000000000003',
      policy,
      ready,
    });
    await initializing;
    expect(crmAccessAuthority.state()).toBe(expected);
    // A ready allowed local owner still opens CRM offline, without a proof.
    expect(fetchProof).not.toHaveBeenCalled();
    expect(owner.transition).not.toHaveBeenCalled();
  }
);

it('keeps immediate browser CRM startup from a matching allowed mirror', async () => {
  const { crmAccessAuthority } = await import('./crm-access-authority');
  crmAccessAuthority.setSession('viewer');
  expect(crmAccessAuthority.allowed()).toBe(true);
});
