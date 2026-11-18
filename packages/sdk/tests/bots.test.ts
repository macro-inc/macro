import { afterEach, describe, expect, test } from 'bun:test';
import type { Bot as BotRecord } from '../generated/storage/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const BOT_ID = '0198a4cc-e138-7670-a308-a6b766602700';
const TEAM_ID = '0198a4cc-e138-7670-a308-a6b766602701';
const CHANNEL_ID = '0198a4cc-e138-7670-a308-a6b766602702';
const MINTED_ID = '0198a4cc-e138-7670-a308-a6b766602703';

const record: BotRecord = {
  id: BOT_ID,
  kind: 'owned',
  owner: { type: 'team', team_id: TEAM_ID },
  name: 'Deploy Bot',
  handle: 'deploy-bot',
  description: null,
  avatar_url: null,
  created_by: 'macro|owner@example.com',
  created_at: '2026-11-05T12:00:00Z',
  updated_at: '2026-11-05T12:00:00Z',
  deleted_at: null,
  has_agent: false,
};

const token = {
  id: MINTED_ID,
  bot_id: BOT_ID,
  token_prefix: 'mbot_abcd',
  label: 'github-webhook',
  last_used_at: null,
  expires_at: null,
  revoked_at: null,
  created_at: '2026-11-05T12:00:00Z',
};

type Call = { method: string; url: string; body: unknown };

/** Answer each request with the next response, recording what was sent. */
function serve(...responses: { status: number; body?: unknown }[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const text = await request.text();
    calls.push({
      method: request.method,
      url: request.url,
      body: text ? JSON.parse(text) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${request.url}`);
    return next.body === undefined
      ? new Response(null, { status: next.status })
      : new Response(JSON.stringify(next.body), {
          status: next.status,
          headers: { 'content-type': 'application/json' },
        });
  }) as typeof fetch;
  return calls;
}

function macro(): Macro {
  return new Macro({
    auth: { type: 'user', token: 'user-key' },
    hosts: { storage: 'https://storage.example.test' },
  });
}

describe('bot management', () => {
  test('list returns seeded handles with their owner', async () => {
    const calls = serve({ status: 200, body: [record] });
    const [bot] = await macro().bots.list();

    expect(calls).toEqual([
      {
        method: 'GET',
        url: 'https://storage.example.test/bots',
        body: undefined,
      },
    ]);
    expect(bot?.id).toBe(BOT_ID);
    expect(await bot?.handle()).toBe('deploy-bot');
    const owner = await bot?.owner();
    expect(owner?.type).toBe('team');
    expect(owner?.type === 'team' ? owner.team.id : undefined).toBe(TEAM_ID);
  });

  test('create sends the team and profile in wire form', async () => {
    const calls = serve({ status: 201, body: record });
    const sdk = macro();
    const bot = await sdk.bots.create({
      name: 'Deploy Bot',
      handle: 'deploy-bot',
      avatarUrl: 'https://static.example.test/bot.png',
      team: sdk.teams.byId(TEAM_ID),
      hasAgent: false,
    });

    expect(bot.id).toBe(BOT_ID);
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://storage.example.test/bots',
        body: {
          name: 'Deploy Bot',
          handle: 'deploy-bot',
          avatar_url: 'https://static.example.test/bot.png',
          team_id: TEAM_ID,
          has_agent: false,
        },
      },
    ]);
  });

  test('update patches only the given fields and refetches afterwards', async () => {
    const calls = serve(
      { status: 200, body: { ...record, description: 'Ships builds' } },
      { status: 200, body: { ...record, description: 'Ships builds' } },
    );
    const bot = macro().bots.byId(BOT_ID);
    await bot.update({ description: 'Ships builds' });

    expect(await bot.description()).toBe('Ships builds');
    expect(calls).toEqual([
      {
        method: 'PATCH',
        url: `https://storage.example.test/bots/${BOT_ID}`,
        body: { description: 'Ships builds' },
      },
      {
        method: 'GET',
        url: `https://storage.example.test/bots/${BOT_ID}`,
        body: undefined,
      },
    ]);
  });

  test('delete removes the bot', async () => {
    const calls = serve({ status: 204 });
    await macro().bots.byId(BOT_ID).delete();

    expect(calls).toEqual([
      {
        method: 'DELETE',
        url: `https://storage.example.test/bots/${BOT_ID}`,
        body: undefined,
      },
    ]);
  });

  test('channel access is granted through the channel and revoked through the bot', async () => {
    const calls = serve({ status: 204 }, { status: 204 });
    const sdk = macro();
    const bot = sdk.bots.byId(BOT_ID);
    const channel = sdk.channels.byId(CHANNEL_ID);
    await bot.grantChannel(channel);
    await bot.revokeChannel(channel);

    expect(calls).toEqual([
      {
        method: 'POST',
        url: `https://storage.example.test/channels/${CHANNEL_ID}/bots`,
        body: { bot_id: BOT_ID },
      },
      {
        method: 'DELETE',
        url: `https://storage.example.test/bots/${BOT_ID}/channels/${CHANNEL_ID}`,
        body: undefined,
      },
    ]);
  });

  test('webhooks name one URL per channel the bot can post to', async () => {
    serve({
      status: 200,
      body: [
        {
          channel_id: CHANNEL_ID,
          name: 'deploys',
          channel_type: 'public',
          joined_at: '2026-11-05T12:00:00Z',
        },
      ],
    });
    const webhooks = await macro().bots.byId(BOT_ID).webhooks();

    expect(webhooks.map((w) => [w.channel.id, w.url])).toEqual([
      [
        CHANNEL_ID,
        `https://storage.example.test/channels/${CHANNEL_ID}/webhook`,
      ],
    ]);
  });

  test('createToken returns the secret once and tokens revoke by bot', async () => {
    const calls = serve(
      { status: 201, body: { token, bearer_token: 'mbot_secret' } },
      { status: 204 },
    );
    const bot = macro().bots.byId(BOT_ID);
    const created = await bot.createToken({
      label: 'github-webhook',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });

    expect(created.secret).toBe('mbot_secret');
    expect(await created.token.prefix()).toBe('mbot_abcd');
    expect(JSON.stringify(created.token)).not.toContain('mbot_secret');
    await created.token.revoke();
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `https://storage.example.test/bots/${BOT_ID}/tokens`,
        body: {
          label: 'github-webhook',
          expires_at: '2027-01-01T00:00:00.000Z',
        },
      },
      {
        method: 'DELETE',
        url: `https://storage.example.test/bots/${BOT_ID}/tokens/${MINTED_ID}`,
        body: undefined,
      },
    ]);
  });

  test('a channel lists the bots that can post to it', async () => {
    const calls = serve({ status: 200, body: [record] });
    const bots = await macro().channels.byId(CHANNEL_ID).bots();

    expect(bots.map((b) => b.id)).toEqual([BOT_ID]);
    expect(calls[0]?.url).toBe(
      `https://storage.example.test/channels/${CHANNEL_ID}/bots`,
    );
  });
});
