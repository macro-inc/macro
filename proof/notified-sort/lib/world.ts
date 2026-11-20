// The synthetic world one seed runs in: a seed-scenario file (users, a team,
// channels of every kind, documents with every share edge, tasks, chats,
// projects, inboxes, thread roots) plus the entities seed-scenario does not
// make (initiatives, calendar events, GitHub pull requests), written in SQL.
// Everything is generated from the seed, including the names, which mix long,
// unicode and colliding values.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Rng } from './rng.ts';

export type Kind =
  | 'document'
  | 'task'
  | 'chat'
  | 'project'
  | 'initiative'
  | 'channel'
  | 'thread'
  | 'email'
  | 'calendar'
  | 'github';

export const KINDS: Kind[] = [
  'document',
  'task',
  'chat',
  'project',
  'initiative',
  'channel',
  'thread',
  'email',
  'calendar',
  'github',
];

/** How the viewer reaches an entity: the permission dimension. */
export type Access =
  | 'owner'
  | 'user-view'
  | 'user-comment'
  | 'user-edit'
  | 'team'
  | 'channel'
  | 'public'
  | 'member'
  | 'participant'
  | 'assignee'
  | 'inbox'
  | 'revoked'
  | 'deleted';

export type Entity = {
  key: string;
  kind: Kind;
  /** Notification event item (type, id), and the secondary one for threads. */
  itemType: string;
  id: string;
  secondary?: { type: string; id: string };
  name: string;
  owner: string;
  access: Access;
  viewer: string;
  /** For channel-scoped entities: the channel and its kind. */
  channel?: { key: string; id: string; type: string };
  important?: boolean;
};

export type Viewer = {
  key: string;
  email: string;
  userId: string;
  role: 'lane' | 'size';
  size?: number;
};

export type World = {
  seed: number;
  scenario: string;
  scenarioFile: string;
  viewers: Viewer[];
  others: { key: string; email: string; userId: string }[];
  entities: Entity[];
  teamId: string;
  extraSql: string;
  linkIds: Record<string, string>;
};

export function deriveId(scenario: string, kind: string, key: string): string {
  const bytes = Buffer.alloc(16);
  bytes[0] = 0x5e;
  bytes[1] = 0xed;
  createHash('sha256').update(scenario).digest().copy(bytes, 2, 0, 2);
  const full = createHash('sha256')
    .update(Buffer.concat([
      Buffer.from(scenario),
      Buffer.from([0]),
      Buffer.from(kind),
      Buffer.from([0]),
      Buffer.from(key),
    ]))
    .digest();
  full.copy(bytes, 4, 0, 12);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const ODD_NAMES = [
  'Ünïcödé plan — Δ',
  '日本語のドキュメント',
  'مستند عربي',
  '🚀 launch 🚀',
  'Same name',
  'Same name',
  'a',
  'Zeta',
  '  leading spaces',
  'Quote "and" \'apostrophe\'',
  'L'.repeat(240),
  `${'Long name '.repeat(20)}end`,
];

function name(rng: Rng, base: string): string {
  return rng.bool(0.35) ? `${rng.pick(ODD_NAMES)} ${base}` : `${base} ${rng.int(1, 999)}`;
}

const sqlStr = (value: string) => `'${value.replaceAll("'", "''")}'`;

export type WorldOptions = {
  seed: number;
  lanes: number;
  sizes: number[];
  outDir: string;
};

export function buildWorld(options: WorldOptions): World {
  const rng = new Rng(options.seed * 7919 + 17);
  const scenario = `nsort-s${options.seed}`;
  const domain = 'seed.macro.local';
  const mail = (key: string) => `${key}.s${options.seed}@${domain}`;
  const users: Record<string, unknown> = {};
  const others = ['b', 'c', 'd'].map((key) => ({
    key,
    email: mail(key),
    userId: `macro|${mail(key)}`,
  }));
  for (const other of others)
    users[other.key] = {
      email: other.email,
      first_name: other.key.toUpperCase(),
      roles: ['team_subscriber', 'sub_opus'],
    };
  const viewers: Viewer[] = [];
  for (let i = 0; i < options.lanes; i++)
    viewers.push({ key: `v${i}`, email: mail(`v${i}`), userId: `macro|${mail(`v${i}`)}`, role: 'lane' });
  for (const size of options.sizes)
    viewers.push({ key: `n${size}`, email: mail(`n${size}`), userId: `macro|${mail(`n${size}`)}`, role: 'size', size });
  for (const viewer of viewers)
    users[viewer.key] = {
      email: viewer.email,
      first_name: viewer.key.toUpperCase(),
      roles: ['team_subscriber', 'sub_opus'],
    };

  const members: Record<string, string> = { c: 'member' };
  for (const viewer of viewers.filter((v) => v.role === 'lane')) members[viewer.key] = 'member';
  const teams = { t: { name: `Team ${options.seed}`, owner: 'b', members } };
  const teamId = deriveId(scenario, 'team', 't');

  const channels: Record<string, unknown> = {
    tch: { type: 'team', team: 't', name: `team-${options.seed}` },
  };
  const documents: Record<string, unknown> = {};
  const tasks: Record<string, unknown> = {};
  const chats: Record<string, unknown> = {};
  const projects: Record<string, unknown> = {};
  const emails: Record<string, unknown> = {};
  const messages: { channel: string; from: string; text: string }[] = [];
  const entities: Entity[] = [];
  const linkIds: Record<string, string> = {};
  let extraSql = '';
  const pastIso = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  const userOf = (key: string) => `macro|${mail(key)}`;

  for (const viewer of viewers) {
    const v = viewer.key;
    const lane = viewer.role === 'lane';
    const r = rng.fork(viewers.indexOf(viewer) + 1);

    if (!lane) {
      // Size viewers: N documents they own, nothing else. Notifications for
      // them are written in bulk later.
      for (let k = 0; k < (viewer.size ?? 0); k++) {
        const key = `${v}-doc${k}`;
        const docName = name(r, `Doc ${k}`);
        documents[key] = { owner: v, name: docName, content: `# ${k}\n` };
        entities.push({
          key,
          kind: 'document',
          itemType: 'document',
          id: deriveId(scenario, 'document', key),
          name: docName,
          owner: v,
          access: 'owner',
          viewer: v,
        });
      }
      continue;
    }

    // Channels of every kind.
    const pub = `${v}-pub`;
    const priv = `${v}-priv`;
    const dm = `${v}-dm`;
    channels[pub] = { type: 'public', owner: 'b', members: [v, 'c'], name: name(r, 'pub').slice(0, 60) };
    channels[priv] = { type: 'private', owner: 'b', members: [v], name: name(r, 'priv').slice(0, 60) };
    channels[dm] = { type: 'direct_message', members: [v, 'b'] };
    const channelEntity = (key: string, type: string, access: Access) =>
      entities.push({
        key,
        kind: 'channel',
        itemType: 'channel',
        id: deriveId(scenario, 'channel', key),
        name: key,
        owner: 'b',
        access,
        viewer: v,
        channel: { key, id: deriveId(scenario, 'channel', key), type },
      });
    channelEntity(pub, 'public', 'member');
    channelEntity(priv, 'private', 'member');
    channelEntity(dm, 'directMessage', 'member');
    channelEntity('tch', 'team', 'team');

    // Thread roots the viewer posts (so the viewer is a participant), and
    // others' messages around them.
    for (const [channel, type] of [
      [pub, 'public'],
      [priv, 'private'],
      ['tch', 'team'],
    ] as const) {
      for (let k = 0; k < 2; k++) {
        const index = messages.length;
        messages.push({ channel, from: v, text: `${name(r, 'root')} ${k}` });
        const id = deriveId(scenario, 'channel_message', String(index));
        entities.push({
          key: `${channel}-root${index}`,
          kind: 'thread',
          itemType: 'channel',
          id,
          secondary: { type: 'channel_message', id },
          name: `thread ${index}`,
          owner: v,
          access: 'participant',
          viewer: v,
          channel: { key: channel, id: deriveId(scenario, 'channel', channel), type },
        });
      }
      messages.push({ channel, from: channel === priv || channel === 'tch' ? 'b' : 'c', text: name(r, 'hello') });
    }
    messages.push({ channel: dm, from: 'b', text: 'dm hello' });

    // Documents with every share edge.
    const shares: [Access, string, () => Record<string, unknown>][] = [
      ['owner', v, () => ({})],
      ['user-view', 'b', () => ({ share: [{ with: `user:${v}`, level: 'view' }] })],
      ['user-comment', 'c', () => ({ share: [{ with: `user:${v}`, level: 'comment' }] })],
      ['user-edit', 'b', () => ({ share: [{ with: `user:${v}`, level: 'edit' }] })],
      ['team', 'c', () => ({ share: [{ with: 'team:t', level: 'view' }] })],
      ['channel', 'b', () => ({ share: [{ with: `channel:${priv}`, level: 'view' }] })],
      ['public', 'd', () => ({ link_share: 'PUBLIC', link_share_access_level: 'view' })],
    ];
    for (let k = 0; k < 12; k++) {
      const [access, owner, extra] = shares[k % shares.length];
      const key = `${v}-doc${k}`;
      const docName = name(r, `Doc ${k}`);
      documents[key] = { owner, name: docName, content: `# ${docName}\n`, ...extra() };
      entities.push({
        key,
        kind: 'document',
        itemType: 'document',
        id: deriveId(scenario, 'document', key),
        name: docName,
        owner,
        access,
        viewer: v,
      });
    }
    // No access (never shared: what a revoked share leaves) and deleted.
    for (const [suffix, owner, access] of [
      ['revoked', 'd', 'revoked'],
      ['deleted', v, 'deleted'],
    ] as const) {
      const key = `${v}-doc-${suffix}`;
      const docName = name(r, `Doc ${suffix}`);
      documents[key] = { owner, name: docName, content: `# ${docName}\n` };
      const id = deriveId(scenario, 'document', key);
      entities.push({ key, kind: 'document', itemType: 'document', id, name: docName, owner, access, viewer: v });
      if (access === 'deleted') extraSql += `UPDATE "Document" SET "deletedAt" = now() WHERE id = ${sqlStr(id)};\n`;
    }
    for (let k = 0; k < 5; k++) {
      const key = `${v}-task${k}`;
      const own = k === 4;
      const taskName = name(r, `Task ${k}`);
      tasks[key] = own
        ? { owner: v, name: taskName }
        : { owner: 'b', name: taskName, assignees: [v], share: [{ with: `user:${v}`, level: 'edit' }] };
      entities.push({
        key,
        kind: 'task',
        itemType: 'document',
        id: deriveId(scenario, 'task', key),
        name: taskName,
        owner: own ? v : 'b',
        access: own ? 'owner' : 'assignee',
        viewer: v,
      });
    }
    for (let k = 0; k < 3; k++) {
      const key = `${v}-chat${k}`;
      const chatName = name(r, `Chat ${k}`);
      chats[key] = { owner: v, name: chatName };
      entities.push({
        key,
        kind: 'chat',
        itemType: 'chat',
        id: deriveId(scenario, 'chat', key),
        name: chatName,
        owner: v,
        access: 'owner',
        viewer: v,
      });
    }
    for (const [k, owner, extra, access] of [
      [0, v, {}, 'owner'],
      [1, 'b', { share: [{ with: `user:${v}`, level: 'view' }] }, 'user-view'],
      [2, 'c', { share: [{ with: 'team:t', level: 'view' }] }, 'team'],
    ] as const) {
      const key = `${v}-proj${k}`;
      const projectName = name(r, `Project ${k}`);
      projects[key] = { owner, name: projectName, ...extra };
      entities.push({
        key,
        kind: 'project',
        itemType: 'project',
        id: deriveId(scenario, 'project', key),
        name: projectName,
        owner,
        access,
        viewer: v,
      });
    }
    // An inbox with threads; importance (Signal vs Noise) is set in SQL.
    const account = `${v}-inbox`;
    const threads: Record<string, unknown> = {};
    for (let k = 0; k < 10; k++) {
      const thread = `t${k}`;
      const subject = name(r, `Mail ${k}`);
      threads[thread] = {
        subject,
        from: `sender${k % 3}@example.com`,
        unread: r.bool(),
        sent_minutes_ago: r.int(1, 60 * 24 * 3),
      };
      const id = deriveId(scenario, 'email_thread', `${account}/${thread}`);
      const important = k % 2 === 0;
      entities.push({
        key: `${account}-${thread}`,
        kind: 'email',
        itemType: 'email_thread',
        id,
        name: subject,
        owner: v,
        access: 'inbox',
        viewer: v,
        important,
      });
      extraSql += `UPDATE email_threads SET is_signal = ${important} WHERE id = ${sqlStr(id)};\n`;
    }
    emails[account] = { owner: v, threads };
    linkIds[v] = deriveId(scenario, 'email_link', account);

    // Initiatives (owned by the viewer, and by b shared through the team).
    for (let k = 0; k < 2; k++) {
      const id = deriveId(scenario, 'initiative', `${v}-${k}`);
      const owner = k === 0 ? v : 'b';
      const initiativeName = name(r, `Initiative ${k}`);
      entities.push({
        key: `${v}-init${k}`,
        kind: 'initiative',
        itemType: 'initiative',
        id,
        name: initiativeName,
        owner,
        access: k === 0 ? 'owner' : 'team',
        viewer: v,
      });
      // The second is b's, reached through b's team link share.
      extraSql += `INSERT INTO "SharePermission" (id, "linkShare") VALUES (${sqlStr(`${id}-sp`)}, ${k === 0 ? 'NULL' : "'TEAM'"}) ON CONFLICT DO NOTHING;\n`;
      extraSql += `INSERT INTO initiative (id, name, owner_user_id, share_permission_id) VALUES (${sqlStr(id)}, ${sqlStr(initiativeName.slice(0, 200).trim() || 'x')}, ${sqlStr(userOf(owner))}, ${sqlStr(`${id}-sp`)}) ON CONFLICT DO NOTHING;\n`;
      if (k === 0)
        extraSql += `INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) SELECT ${sqlStr(id)}, 'initiative', ${sqlStr(userOf(v))}, 'user', 'owner' WHERE NOT EXISTS (SELECT 1 FROM entity_access WHERE entity_id = ${sqlStr(id)} AND source_id = ${sqlStr(userOf(v))});\n`;
    }
    // Calendar events on the viewer's inbox link.
    for (let k = 0; k < 3; k++) {
      const id = deriveId(scenario, 'calendar_event', `${v}-${k}`);
      const title = name(r, `Event ${k}`);
      entities.push({
        key: `${v}-cal${k}`,
        kind: 'calendar',
        itemType: 'calendar_event',
        id,
        name: title,
        owner: v,
        access: 'owner',
        viewer: v,
      });
      extraSql += `INSERT INTO calendar_events (id, owner_id, source_link_id, ical_uid, title, starts_at, ends_at, canonical_source_kind) VALUES (${sqlStr(id)}, ${sqlStr(userOf(v))}, ${sqlStr(linkIds[v])}, ${sqlStr(`${id}@seed`)}, ${sqlStr(title)}, ${sqlStr(pastIso(-60 * (k + 1)))}, ${sqlStr(pastIso(-60 * (k + 2)))}, 'google') ON CONFLICT DO NOTHING;\n`;
    }
    // GitHub pull requests stored for the viewer.
    for (let k = 0; k < 2; k++) {
      const id = deriveId(scenario, 'foreign_entity', `${v}-${k}`);
      const number = r.int(1, 99999);
      const title = name(r, `PR ${k}`);
      entities.push({
        key: `${v}-gh${k}`,
        kind: 'github',
        itemType: 'foreign_entity',
        id,
        name: title,
        owner: v,
        access: 'owner',
        viewer: v,
      });
      const metadata = {
        owner: 'seed-org',
        repo: 'seed-repo',
        number,
        title,
        url: `https://github.com/seed-org/seed-repo/pull/${number}`,
        state: 'open',
        draft: false,
        author: { login: 'seed-author', id: 1 },
        repository_id: 1000 + k,
      };
      extraSql += `INSERT INTO foreign_entity (id, foreign_entity_id, foreign_entity_source, metadata, stored_for_id, stored_for_auth_entity) VALUES (${sqlStr(id)}, ${sqlStr(`seed-org/seed-repo#${number}`)}, 'github_pull_request', ${sqlStr(JSON.stringify(metadata))}::jsonb, ${sqlStr(userOf(v))}, 'user') ON CONFLICT DO NOTHING;\n`;
    }
  }

  const scenarioJson = {
    scenario,
    description: 'Synthetic world for the notified-at sort differential (generated).',
    users,
    teams,
    channels,
    projects,
    documents,
    tasks,
    chats,
    emails,
    messages,
  };
  const scenarioFile = `${options.outDir}/${scenario}.json`;
  writeFileSync(scenarioFile, JSON.stringify(scenarioJson, null, 1));
  return {
    seed: options.seed,
    scenario,
    scenarioFile,
    viewers,
    others,
    entities,
    teamId,
    extraSql,
    linkIds,
  };
}
