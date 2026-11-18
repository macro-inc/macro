import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
test('member access uses fresh reads and the admin patch without changing contribution settings', async () => {
  let allowed = true;
  let forbidden = false;
  const writes: unknown[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      const path = new URL(request.url).pathname;
      if (path === '/crm/member-access')
        return Response.json({ team_id: 'team-1', allowed });
      if (request.method === 'PATCH') {
        const body = await request.json();
        writes.push(body);
        if (forbidden)
          return Response.json({ message: 'Forbidden' }, { status: 403 });
        allowed = body.member_crm_access.enabled;
        return Response.json(null);
      }
      return Response.json({
        team: { id: 'team-1' },
        members: [
          { user_id: 'member-1', role: 'member' },
          { user_id: 'owner-1', role: 'owner' },
        ],
        crm_member_access: { 'member-1': allowed, 'owner-1': true },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { auth: 'https://auth.test', storage: 'https://storage.test' },
  });
  const team = macro.teams.byId('team-1');
  const member = macro.users.byId('member-1');
  for (const enabled of [true, false, true]) {
    await team.setMemberCrmAccess(member, enabled);
    expect((await macro.crm.access()).allowed).toBe(enabled);
    expect((await team.members()).map((entry) => entry.crmAccess)).toEqual([
      enabled,
      true,
    ]);
  }
  expect(writes).toEqual(
    [true, false, true].map((enabled) => ({
      member_crm_access: { user_id: 'member-1', enabled },
    })),
  );
  forbidden = true;
  await expect(team.setMemberCrmAccess(member, false)).rejects.toThrow();
  expect((await macro.crm.access()).allowed).toBe(true);
});
