import { platformFetch } from '@core/util/platformFetch';
import { afterEach, expect, it, vi } from 'vitest';
import { crmEmailPolicyClient } from './crm-email-policy';

vi.mock('@core/util/platformFetch', () => ({ platformFetch: vi.fn() }));
const transport = vi.mocked(platformFetch);
afterEach(() => transport.mockReset());

it.each([400, 413, 422, 429])(
  'preserves a server limit refusal (%s) through the real transport',
  async (status) => {
    const message = 'Rule discovery limit exceeded: 2000 addresses.';
    transport.mockResolvedValueOnce(Response.json({ message }, { status }));
    const draft = '{"schema_version":1,"include":[],"unknown":true}';
    const result = await crmEmailPolicyClient.validate(draft);
    expect(result._unsafeUnwrapErr()).toEqual([
      { code: 'HTTP_ERROR', message },
    ]);
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/crm/email-privacy/policy/validate'),
      expect.objectContaining({ method: 'POST', body: draft })
    );
  }
);

it('returns a conflict without retrying the old policy decision', async () => {
  transport.mockResolvedValueOnce(
    Response.json({ message: 'Consent changed' }, { status: 409 })
  );
  const result = await crmEmailPolicyClient.replace({
    change: { action: 'enable_all' },
    if_policy: { kind: 'legacy', fingerprint: 'observed' },
    request_id: '00000000-0000-4000-8000-000000000001',
  });
  expect(result._unsafeUnwrapErr()).toEqual([
    { code: 'CONFLICT', message: 'Consent changed' },
  ]);
  expect(transport).toHaveBeenCalledTimes(1);
});

it('represents absent preview slots and revisions as null', async () => {
  transport.mockResolvedValueOnce(Response.json(null));
  expect((await crmEmailPolicyClient.preview())._unsafeUnwrap()).toBeNull();
  transport.mockResolvedValueOnce(Response.json(null));
  expect((await crmEmailPolicyClient.revision(1))._unsafeUnwrap()).toBeNull();
});
