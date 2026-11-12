// The secrets capability against the stub vault: what the agent can do, what it is told, and that it never sees a value.
import { expect, test } from 'bun:test';
import { invoke } from '../../../../test/invoke.ts';
import {
  copySecret,
  copySecretCode,
  createSecret,
  requestSecretAccess,
  type SecretHit,
  searchSecrets,
  secretsModule,
  updateSecret,
} from '../index.ts';
import { rig, teamId } from './rig.ts';

const password = 'correct-horse-battery-staple';
const login = { type: 'login' as const, username: 'ada', password };

/** What a call threw, as the agent would read it. */
const thrown = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('it did not throw');
};

const found = async (
  context: ReturnType<typeof rig>['context'],
  name: string
): Promise<SecretHit> => {
  const hit = (await searchSecrets(context, { query: name })).find(
    (each) => each.name === name
  );
  if (hit === undefined) throw new Error(`no ${name}`);
  return hit;
};

test('search finds what the team could share, with whether it is usable, and never a value', async () => {
  const { context, stub } = rig();
  const id = stub.add({
    name: 'Example login',
    kind: 'login',
    url: 'https://example.com',
    secret: login,
  });
  const hits = await searchSecrets(context, { query: 'example' });
  expect(hits).toEqual([
    {
      teamId,
      itemId: id,
      name: 'Example login',
      kind: 'login',
      url: 'https://example.com',
      access: 'request_access',
      canUpdate: false,
      version: 1,
      fields: ['username', 'password'],
    },
  ]);
  expect(JSON.stringify(hits)).not.toContain(password);
  expect(await searchSecrets(context, { query: 'nothing like it' })).toEqual(
    []
  );
});

test('what the agent creates it can copy at once, with no request', async () => {
  const { context, clipboard, stub } = rig();
  const created = await createSecret(context, {
    name: 'New service',
    kind: 'login',
    url: 'https://new.example.com',
    username: 'agent',
    value: 'made-up-password-0123456789',
  });
  expect(created.item).toMatchObject({
    name: 'New service',
    access: 'usable',
    canUpdate: true,
  });
  expect(
    await copySecret(context, { item: created.item, field: 'password' })
  ).toBe('Copied New service password');
  expect(clipboard.text).toBe('made-up-password-0123456789');
  expect(
    await copySecret(context, { item: created.item, field: 'username' })
  ).toBe('Copied New service username');
  expect(clipboard.text).toBe('agent');
  // Nothing was asked for: no request ever went to the vault.
  expect(
    stub.calls.filter(({ path }) => path.includes('access-requests'))
  ).toEqual([]);
});

test('a shared item is asked for, waits on the owner, and is usable once approved', async () => {
  const { context, stub, clipboard, polling } = rig();
  const id = stub.add({ name: 'Shared', kind: 'login', secret: login });
  const item = await found(context, 'Shared');
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toBe(
    'you have no access to "Shared": ask your owner for it with requestSecretAccess'
  );
  expect(await requestSecretAccess(context, { item })).toBe('Requested');
  expect(polling.on).toBe(true);
  // Asking again is the same request, not a second one.
  expect(await requestSecretAccess(context, { item })).toBe('Requested');
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toBe(
    'access to "Shared" is waiting on your owner\'s approval: you are woken when it is decided'
  );
  expect((await found(context, 'Shared')).access).toBe('pending');
  stub.owner.approve(id, 'view');
  expect(await copySecret(context, { item, field: 'password' })).toBe(
    'Copied Shared password'
  );
  expect(clipboard.text).toBe(password);
  expect(await requestSecretAccess(context, { item })).toBe('Already usable');
});

test('a grant without the first-use approval is pending', async () => {
  const { context, stub } = rig();
  const id = stub.add({ name: 'Granted', kind: 'login', secret: login });
  stub.owner.share(id, 'view');
  const item = await found(context, 'Granted');
  expect(item.access).toBe('request_access');
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toContain('waiting on your owner');
});

test('a team-wide share grants an agent nothing: the item is request_access', async () => {
  const { context, stub } = rig();
  stub.add({ name: 'Team item', kind: 'login', secret: login, share: 'team' });
  stub.add({
    name: 'Private item',
    kind: 'login',
    secret: login,
    share: 'private',
  });
  const hits = await searchSecrets(context, { query: 'item' });
  expect(hits.map(({ name, access }) => [name, access])).toEqual([
    ['Team item', 'request_access'],
  ]);
  const [item] = hits;
  if (item === undefined) throw new Error('no item');
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toContain('you have no access to "Team item"');
});

test('a creator without a current grant is not granted, never pending, even once it asks', async () => {
  const { context, stub } = rig();
  const created = await createSecret(context, {
    name: 'Mine',
    kind: 'api',
    value: 'api-key-0123456789abcdef',
  });
  stub.owner.revoke(created.item.itemId, 'grant_and_approval');
  const notGranted = 'you have no access to "Mine"';
  expect(
    await thrown(() =>
      copySecret(context, { item: created.item, field: 'key' })
    )
  ).toContain(notGranted);
  expect(await requestSecretAccess(context, { item: created.item })).toBe(
    'Requested'
  );
  expect((await found(context, 'Mine')).access).toBe('request_access');
  expect(
    await thrown(() =>
      copySecret(context, { item: created.item, field: 'key' })
    )
  ).toContain(notGranted);
});

test('a TOTP code is copied, never the seed', async () => {
  const { context, stub, clipboard } = rig();
  const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const id = stub.add({
    name: 'With code',
    kind: 'login',
    secret: login,
    totpSeed: seed,
  });
  stub.owner.approve(id, 'view');
  const item = await found(context, 'With code');
  expect(await copySecretCode(context, { item })).toBe(
    'Copied code for With code'
  );
  expect(clipboard.text).toMatch(/^\d{6}$/);
});

test('create and update can take the value from the clipboard, and never hand it back', async () => {
  const { context, clipboard, stub } = rig();
  clipboard.text = 'from-the-page-0123456789';
  const created = await createSecret(context, {
    name: 'From clipboard',
    kind: 'login',
    username: 'agent',
    fromClipboard: true,
  });
  expect(stub.secretOf(created.item.itemId)).toEqual({
    type: 'login',
    username: 'agent',
    password: 'from-the-page-0123456789',
  });
  expect(JSON.stringify(created)).not.toContain('from-the-page');

  clipboard.text = 'rotated-0123456789abcdef';
  const updated = await updateSecret(context, {
    item: created.item,
    fromClipboard: true,
  });
  expect(updated.version).toBe(created.version + 1);
  expect(stub.secretOf(created.item.itemId)).toMatchObject({
    password: 'rotated-0123456789abcdef',
  });
  expect(JSON.stringify(updated)).not.toContain('rotated');

  // The item each call hands back carries its new version, so it can be changed again.
  const renamed = await updateSecret(context, {
    item: updated.item,
    name: 'Renamed',
  });
  expect(renamed.item.name).toBe('Renamed');
  expect(renamed.item.version).toBe(updated.version + 1);
});

test('a search hit carries its version, which an update and a copy send, and a changed item is a conflict', async () => {
  const { context, stub } = rig();
  const id = stub.add({ name: 'Viewable', kind: 'login', secret: login });
  stub.owner.approve(id, 'view');
  const item = await found(context, 'Viewable');
  expect(item.version).toBe(1);
  expect(
    await thrown(() =>
      updateSecret(context, { item, value: 'new-0123456789abc' })
    )
  ).toBe('you may not change "Viewable"');
  stub.owner.approve(id, 'edit');
  const updated = await updateSecret(context, {
    item,
    value: 'new-0123456789abc',
  });
  expect(updated.version).toBe(2);
  const updates = stub.calls.filter(({ method }) => method === 'PATCH');
  expect(JSON.parse(updates.at(-1)?.body ?? '{}')).toMatchObject({
    expectedVersion: 1,
  });
  // The hit from before the update is stale now.
  const changed = 'changed since you last saw it: search for it again';
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toContain(changed);
  expect(
    await thrown(() => updateSecret(context, { item, name: 'Again' }))
  ).toContain(changed);
  expect(
    await copySecret(context, { item: updated.item, field: 'password' })
  ).toBe('Copied Viewable password');
  // An item handed over without its version must be looked up first.
  const { version: _, ...unversioned } = item;
  expect(
    await thrown(() => updateSecret(context, { item: unversioned, name: 'X' }))
  ).toContain('search for "Viewable" first');
});

test("with the flag off, team calls say secrets aren't turned on; item calls can't tell that from a missing item", async () => {
  const { context, stub } = rig();
  const id = stub.add({ name: 'Here', kind: 'login', secret: login });
  stub.owner.approve(id, 'view');
  const item = await found(context, 'Here');
  stub.flags.enabled = false;
  expect(await thrown(() => searchSecrets(context, {}))).toBe(
    "secrets aren't turned on for this team"
  );
  expect(
    await thrown(() =>
      createSecret(context, { name: 'X', kind: 'note', value: 'text' })
    )
  ).toBe("secrets aren't turned on for this team");
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toBe(
    'no secret "Here" in your team\'s vault, or secrets aren\'t turned on for this team'
  );
});

test('input a type cannot rule out is refused with a clear error', async () => {
  const { context, stub } = rig();
  stub.add({ name: 'Note', kind: 'note', secret: { type: 'note', text: 't' } });
  const item = await found(context, 'Note');
  expect(
    await thrown(() => copySecret(context, { item, field: 'password' }))
  ).toBe('a note has no password: its fields are text');
  for (const input of [
    { name: 'X', kind: 'login' },
    { name: 'X', kind: 'login', value: 'v', fromClipboard: true },
    { name: ' ', kind: 'login', value: 'v' },
  ]) {
    const refused = await invoke(secretsModule, 'createSecret', context, input);
    expect(refused.kind).toBe('failed');
  }
  expect(await thrown(() => updateSecret(context, { item }))).toBe(
    'nothing to change: give a value, fromClipboard, username, name or url'
  );
  // A kind the agent can't create doesn't type-check.
  const card = await invoke(secretsModule, 'createSecret', context, {
    name: 'Card',
    kind: 'card',
    value: 'v',
  });
  expect(card.kind).toBe('invalid');
});

test('a secret value never appears in anything a function returns, logs, writes or throws', async () => {
  const { context, stub, disk, clipboard } = rig();
  const sentinel = 'SENTINEL-secret-value-9f8e7d6c';
  const outputs: unknown[] = [];
  const record = async (run: () => Promise<unknown>) => {
    try {
      outputs.push(await run());
    } catch (error) {
      outputs.push(error instanceof Error ? error.message : error);
    }
  };
  const id = stub.add({
    name: 'Guarded',
    kind: 'login',
    secret: { type: 'login', username: sentinel, password: sentinel },
    totpSeed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  });
  const item = await found(context, 'Guarded');
  await record(() => copySecret(context, { item, field: 'password' }));
  await record(() => requestSecretAccess(context, { item }));
  stub.owner.approve(id, 'edit');
  await record(() => copySecret(context, { item, field: 'password' }));
  await record(() => copySecret(context, { item, field: 'username' }));
  await record(() => copySecretCode(context, { item }));
  await record(() => updateSecret(context, { item, value: sentinel }));
  clipboard.text = sentinel;
  await record(() =>
    createSecret(context, { name: 'Also', kind: 'login', fromClipboard: true })
  );
  await record(() =>
    updateSecret(context, {
      item: { ...item, version: 99 },
      fromClipboard: true,
    })
  );
  stub.flags.busy = 10;
  await record(() => copySecret(context, { item, field: 'password' }));
  await record(() => searchSecrets(context, { query: 'Guarded' }));
  // The value did reach the clipboard and the vault, and nothing else.
  expect(outputs).toHaveLength(10);
  expect(JSON.stringify(outputs)).not.toContain(sentinel);
  expect(JSON.stringify([...disk.files.entries()])).not.toContain(sentinel);
  expect(disk.files.size).toBeGreaterThan(0);
});
