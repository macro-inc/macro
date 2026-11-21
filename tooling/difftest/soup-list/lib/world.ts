/**
 * A seeded world: synthetic users, a team, and their entities, created through
 * the services' own APIs (and SQL only for GitHub pull requests, which only a
 * GitHub sync creates, and for exact timestamp ties).
 */
import { ApiUser } from './api';
import { oddName } from './names';
import { pool } from './pool';
import { Coverage, Rng } from './rng';
import { lit, sql } from './sql';

// Document creates per world. Each one makes DSS ask the lexical service for a
// snapshot, which asks the sync service; four worlds at 24 each timed the sync
// service out on a loaded machine and failed the build.
const CREATE_CONCURRENCY = 8;

export type UserKey = 'owner' | 'member' | 'outsider' | 'empty' | 'boundary';
export const USER_KEYS: UserKey[] = ['owner', 'member', 'outsider', 'empty', 'boundary'];

export type EntityKind =
  | 'md'
  | 'task'
  | 'snippet'
  | 'skill'
  | 'project'
  | 'crm'
  | 'initiative'
  | 'channel'
  | 'chat'
  | 'session'
  | 'pr';

export type Access = 'private' | 'team' | 'channel' | 'public' | 'revoked' | 'deleted';

export type Ent = {
  kind: EntityKind;
  id: string;
  owner: UserKey;
  name: string;
  projectId?: string;
  access: Access;
  deleted?: boolean;
  hidden?: boolean;
};

export type World = {
  seed: string;
  tag: string;
  domain: string;
  instance: string;
  users: Record<UserKey, ApiUser>;
  teamId: string;
  channelId: string;
  entities: Ent[];
  coverage: Coverage;
  sizes: Record<string, number>;
};

export type Scale = 'full' | 'small';

function plan(rng: Rng, scale: Scale) {
  const f = scale === 'full' ? 1 : 0.04;
  const n = (min: number, max: number) => Math.max(1, Math.round(rng.int(min, max) * f));
  return {
    ownerMd: n(900, 1400),
    ownerTasks: n(150, 300),
    // Quick Access feeds read 500: one seed sits on the boundary, one past it.
    ownerSnippets: scale === 'full' ? rng.pick([500, 501]) : 6,
    ownerSkills: n(20, 60),
    ownerProjects: n(12, 20),
    ownerChats: n(15, 30),
    ownerSessions: n(15, 30),
    ownerInitiatives: n(25, 50),
    ownerPrs: n(80, 140),
    // CRM export pages are 500 rows.
    crmCompanies: scale === 'full' ? rng.pick([1000, 1037]) : 12,
    memberMd: n(40, 80),
    memberTasks: n(20, 40),
    memberSkills: n(3, 8),
    memberInitiatives: n(3, 8),
    boundarySkills: scale === 'full' ? 500 : 5,
    outsiderMd: n(3, 8),
  };
}

export async function buildWorld(args: {
  instance: string;
  origin: string;
  seed: string;
  scale: Scale;
  log?: (line: string) => void;
  /**
   * Only the owner and the member (sequence and mutant worlds): the auth
   * service lets one address create 50 users an hour.
   */
  lean?: boolean;
}): Promise<World> {
  const { instance, origin, seed, scale } = args;
  const keys: UserKey[] = args.lean ? ['owner', 'member'] : USER_KEYS;
  const log = args.log ?? (() => {});
  const rng = new Rng(`world/${seed}`);
  const tag = `${seed}-${Date.now().toString(36)}`;
  const domain = `w${tag}.difftest.dev`.toLowerCase();
  const coverage = new Coverage();
  const sizes = plan(rng, scale);
  const users = Object.fromEntries(
    keys.map((key) => [key, new ApiUser(origin, `${key}@${domain}`)])
  ) as Record<UserKey, ApiUser>;
  for (const user of Object.values(users)) await user.login();
  // The outsider and the empty user stay out of the team: give them their own
  // domains' worth of nothing by signing them in before the team exists is
  // not enough (domain join), so the team turns domain join off.
  const team = await users.owner.post<{ id: string }>('/auth/team', {
    name: `Difftest ${tag}`,
    allow_domain_join: false,
  });
  await users.owner.post('/auth/team/invite', {
    invites: [
      { email: users.member.email, tier: 'member' },
      ...(users.boundary ? [{ email: users.boundary.email, tier: 'member' }] : []),
    ],
  });
  for (const key of (['member', 'boundary'] as const).filter((k) => users[k])) {
    const { invites } = await users[key].get<{ invites: { id: string }[] }>(
      '/auth/team/user/invites'
    );
    for (const invite of invites) await users[key].get(`/auth/team/join/${invite.id}`);
  }
  log(`world ${seed}: users and team ${team.id}`);

  const entities: Ent[] = [];
  const ties: string[] = [];
  const name = (label: string, i: number, maxChars?: number) => {
    const n = oddName(rng, label, i, ties, coverage, maxChars);
    return maxChars ? [...n].slice(0, maxChars).join("") : n;
  };

  const channel = await users.owner.post<{ id: string }>('/dss/channels', {
    channel_type: 'private',
    name: `Difftest channel ${tag}`,
    participants: [users.member.id],
  });
  entities.push({ kind: 'channel', id: channel.id, owner: 'owner', name: 'channel', access: 'channel' });

  const projects: string[] = [];
  for (let i = 0; i < sizes.ownerProjects; i++) {
    const p = await users.owner.post<{ data: { id: string } }>('/dss/projects', {
      name: name('Project', i, 100),
      ...(projects.length && rng.bool(0.3) && { projectParentId: rng.pick(projects) }),
    });
    projects.push(p.data.id);
    entities.push({ kind: 'project', id: p.data.id, owner: 'owner', name: 'project', access: 'private' });
  }

  type DocJob = { kind: 'md' | 'task' | 'snippet' | 'skill'; owner: UserKey; i: number };
  const jobs: DocJob[] = [];
  const add = (kind: DocJob['kind'], owner: UserKey, count: number) => {
    for (let i = 0; i < count; i++) jobs.push({ kind, owner, i });
  };
  add('md', 'owner', sizes.ownerMd);
  add('task', 'owner', sizes.ownerTasks);
  add('snippet', 'owner', sizes.ownerSnippets);
  add('skill', 'owner', sizes.ownerSkills);
  add('md', 'member', sizes.memberMd);
  add('task', 'member', sizes.memberTasks);
  add('skill', 'member', sizes.memberSkills);
  add('snippet', 'member', 1);
  if (users.boundary) {
    add('skill', 'boundary', sizes.boundarySkills);
    add('snippet', 'boundary', 1);
  }
  if (users.outsider) add('md', 'outsider', sizes.outsiderMd);
  const docNames = jobs.map((job) => name(job.kind, job.i));
  const docs = await pool(jobs, CREATE_CONCURRENCY, async (job, index) => {
    const user = users[job.owner];
    const docName = docNames[index];
    const projectId = job.owner === 'owner' && rng.bool(0.25) ? rng.pick(projects) : undefined;
    let id: string;
    switch (job.kind) {
      case 'md':
        id = (
          await user.post<{ documentId: string }>('/dss/documents/create_markdown', {
            documentName: docName,
            markdown: `synthetic ${index}`,
            skipHistory: true,
            ...(projectId && { projectId }),
          })
        ).documentId;
        break;
      case 'task':
        id = (
          await user.post<{ documentId: string }>('/dss/documents/create_task', {
            taskName: docName,
            shareWithTeam: rng.bool(0.6),
            ...(projectId && { projectId }),
          })
        ).documentId;
        break;
      case 'snippet':
        id = (
          await user.post<{ documentId: string }>('/dss/documents/create_snippet', {
            snippetName: docName,
            ...(projectId && { projectId }),
          })
        ).documentId;
        break;
      case 'skill':
        id = (
          await user.post<{ documentId: string }>('/dss/documents/create_skill', {
            skillName: docName,
            description: `Use when testing ${index}`,
            ...(projectId && { projectId }),
          })
        ).documentId;
        break;
    }
    const ent: Ent = { kind: job.kind, id, owner: job.owner, name: docName, projectId, access: 'private' };
    coverage.hit('kind', job.kind);
    return ent;
  });
  entities.push(...docs);
  log(`world ${seed}: ${docs.length} documents`);

  // Permissions across the owner's documents.
  const ownerDocs = docs.filter((d) => d.owner === 'owner');
  await pool(ownerDocs, CREATE_CONCURRENCY, async (doc) => {
    const access = rng.weighted<Access>([
      [40, 'private'],
      [22, 'team'],
      [12, 'channel'],
      [8, 'public'],
      [10, 'revoked'],
      [8, 'deleted'],
    ]);
    doc.access = access;
    coverage.hit('access', access);
    const id = doc.id;
    const owner = users.owner;
    switch (access) {
      case 'team':
        await owner.put(`/dss/documents/${id}/team_share`, { shareWithTeam: true });
        break;
      case 'channel':
        await owner.patch(`/dss/documents/${id}`, {
          sharePermission: {
            channelSharePermissions: [
              { channelId: channel.id, operation: 'add', accessLevel: 'view' },
            ],
          },
        });
        break;
      case 'public':
        await owner.patch(`/dss/documents/${id}`, {
          sharePermission: { linkShare: 'PUBLIC', linkShareAccessLevel: 'view' },
        });
        break;
      case 'revoked':
        if (rng.bool()) {
          await owner.put(`/dss/documents/${id}/team_share`, { shareWithTeam: true });
          await owner.put(`/dss/documents/${id}/team_share`, { shareWithTeam: false });
        } else {
          await owner.patch(`/dss/documents/${id}`, {
            sharePermission: {
              channelSharePermissions: [
                { channelId: channel.id, operation: 'add', accessLevel: 'view' },
              ],
            },
          });
          await owner.patch(`/dss/documents/${id}`, {
            sharePermission: {
              channelSharePermissions: [{ channelId: channel.id, operation: 'remove' }],
            },
          });
        }
        break;
      case 'deleted':
        await owner.del(`/dss/documents/${id}`);
        doc.deleted = true;
        break;
    }
  });
  log(`world ${seed}: permissions`);

  // CRM companies for the team, some hidden, some name-only.
  const crmJobs = Array.from({ length: sizes.crmCompanies }, (_, i) => i);
  const crmNames = crmJobs.map((i) => name('Company', i));
  const companies = await pool(crmJobs, 16, async (i) => {
    const withDomain = rng.bool(0.6);
    const company = await users.owner.post<{ id: string }>('/dss/crm/companies', {
      name: crmNames[i],
      ...(withDomain && { domain: `co${i}-${tag}.io`.toLowerCase() }),
    });
    const hidden = rng.bool(0.08);
    if (hidden)
      await users.owner.put(`/dss/crm/companies/${company.id}/hidden`, { hidden: true });
    coverage.hit('crm', withDomain ? 'domain' : 'name-only');
    if (hidden) coverage.hit('crm', 'hidden');
    return {
      kind: 'crm',
      id: company.id,
      owner: 'owner',
      name: crmNames[i],
      access: 'team',
      hidden,
    } satisfies Ent;
  });
  entities.push(...companies);
  log(`world ${seed}: ${companies.length} companies`);

  const initiativeJobs: UserKey[] = [
    ...Array<UserKey>(sizes.ownerInitiatives).fill('owner'),
    ...Array<UserKey>(sizes.memberInitiatives).fill('member'),
  ];
  const initiatives = await pool(initiativeJobs, 12, async (owner, i) => {
    const iname = name("Initiative", i, 100);
    const shareWithTeam = rng.bool(0.6);
    const result = await users[owner].graphql<{ createInitiative: { id: string } }>(
      'mutation C($input: CreateInitiativeInput!){ createInitiative(input:$input){ id } }',
      { input: { name: iname, shareWithTeam } }
    );
    coverage.hit('kind', 'initiative');
    return {
      kind: 'initiative',
      id: result.createInitiative.id,
      owner,
      name: iname,
      access: shareWithTeam ? 'team' : 'private',
    } satisfies Ent;
  });
  entities.push(...initiatives);

  const chats = await pool(Array.from({ length: sizes.ownerChats }, (_, i) => i), 8, async (i) => {
    const cname = name('Chat', i, 100);
    const chat = await users.owner.post<{ id: string }>('/cognition/chats', { name: cname });
    coverage.hit('kind', 'chat');
    return { kind: 'chat', id: chat.id, owner: 'owner', name: cname, access: 'private' } satisfies Ent;
  });
  entities.push(...chats);

  const sessions = await pool(Array.from({ length: sizes.ownerSessions }, (_, i) => i), 6, async (i) => {
    const sname = name('Session', i, 100);
    const { session } = await users.owner.post<{ session: { id: string } }>(
      '/agent-harness/agent-sessions',
      {}
    );
    coverage.hit('kind', 'session');
    return { kind: 'session', id: session.id, owner: 'owner', name: sname, access: 'private' } satisfies Ent;
  });
  entities.push(...sessions);
  if (sessions.length)
    await sql(
      instance,
      sessions
        .map((s) => `UPDATE agent_session SET name = ${lit(s.name)} WHERE id = ${lit(s.id)};`)
        .join('\n')
    );

  // GitHub pull requests, stored for the owner (some for the team).
  const prRows: string[] = [];
  // Repository ids are unique per world: (repository_id, number) is unique.
  const repoBase = 1000 + 3 * (Number(Bun.hash(tag) % 300_000_000n));
  const prs: Ent[] = [];
  for (let i = 0; i < sizes.ownerPrs; i++) {
    const key = `difftest-${tag}/repo${i % 3}/pull/${i + 1}`;
    const title = name('PR', i);
    const forTeam = rng.bool(0.3);
    const status = rng.pick(['open', 'closed', 'merged']);
    const at = new Date(Date.UTC(2026, 9, 1) + rng.int(0, 40 * 86400) * 1000).toISOString();
    prRows.push(
      `INSERT INTO github_pull_request (github_key, repository_id, number, owner, repo, title, status, draft, author_login, github_updated_at) VALUES (${lit(key)}, ${repoBase + (i % 3)}, ${i + 1}, ${lit(`difftest-${tag}`)}, ${lit(`repo${i % 3}`)}, ${lit(title)}, ${lit(status)}, ${rng.bool(0.2)}, 'synthetic-bot', ${lit(at)});`,
      `INSERT INTO foreign_entity (id, foreign_entity_id, foreign_entity_source, metadata, stored_for_id, stored_for_auth_entity, created_at, updated_at) VALUES (gen_random_uuid(), ${lit(key)}, 'github_pull_request', '{}', ${lit(forTeam ? team.id : users.owner.id)}, ${lit(forTeam ? 'team' : 'user')}, ${lit(at)}, ${lit(at)});`
    );
    prs.push({ kind: 'pr', id: key, owner: 'owner', name: title, access: forTeam ? 'team' : 'private' });
    coverage.hit('kind', 'pr');
  }
  if (prRows.length) await sql(instance, prRows.join('\n'));
  entities.push(...prs);
  log(`world ${seed}: initiatives, chats, sessions, PRs`);

  // History: the owner and the member view a subset, the outsider views
  // public documents. Then exact ties on a slice of timestamps.
  const viewable = (key: UserKey) =>
    entities.filter((e) => !e.deleted && (e.owner === key || (key !== 'owner' && (e.access === 'team' || e.access === 'channel'))));
  const views: { user: UserKey; ent: Ent }[] = [];
  for (const ent of rng.sample(viewable('owner'), Math.min(400, viewable('owner').length)))
    views.push({ user: 'owner', ent });
  for (const ent of rng.sample(viewable('member'), 60)) views.push({ user: 'member', ent });
  if (users.outsider)
    for (const ent of entities.filter((e) => e.access === 'public' && !e.deleted).slice(0, 10))
      views.push({ user: 'outsider', ent });
  const itemType = (kind: EntityKind) =>
    ({ md: 'document', task: 'document', snippet: 'document', skill: 'document', project: 'project', chat: 'chat', channel: 'channel', initiative: 'initiative', crm: 'crm_company', session: 'agent_session', pr: 'foreign_entity' })[kind];
  await pool(views, 24, async ({ user, ent }) => {
    if (ent.kind === 'pr' || ent.kind === 'channel') return;
    try {
      await users[user].post(`/dss/history/${itemType(ent.kind)}/${ent.id}`);
      coverage.hit('viewed', ent.kind);
    } catch {
      coverage.hit('viewed-rejected', ent.kind);
    }
  });
  const tieDocs = rng.sample(docs.filter((d) => d.owner === 'owner' && !d.deleted), 40);
  const tieAt = new Date(Date.UTC(2026, 10, 1, 12)).toISOString();
  await sql(
    instance,
    `UPDATE "Document" SET "updatedAt" = ${lit(tieAt)}, "createdAt" = ${lit(tieAt)} WHERE id IN (${tieDocs.map((d) => lit(d.id)).join(',')});`
  );
  coverage.hit('ties', 'document-timestamps', tieDocs.length);
  log(`world ${seed}: history and ties`);
  await linkPullRequests({ instance, rng, entities, coverage });
  log(`world ${seed}: PR links`);

  return {
    seed,
    tag,
    domain,
    instance,
    users,
    teamId: team.id,
    channelId: channel.id,
    entities,
    coverage,
    sizes,
  };
}

/** The world without its sessions, for reuse across runs of the same seed. */
export function worldToJSON(world: World) {
  return {
    ...world,
    users: Object.fromEntries(Object.entries(world.users).map(([k, u]) => [k, u.email])),
    coverage: world.coverage.toJSON(),
  };
}

export async function loadWorld(path: string, origin: string): Promise<World> {
  const json = JSON.parse(await Bun.file(path).text());
  const users = Object.fromEntries(
    Object.entries<string>(json.users).map(([k, email]) => [k, new ApiUser(origin, email)])
  ) as Record<UserKey, ApiUser>;
  for (const user of Object.values(users)) await user.login();
  const coverage = new Coverage();
  for (const [dim, values] of Object.entries<Record<string, number>>(json.coverage ?? {}))
    for (const [value, n] of Object.entries(values)) coverage.hit(dim, value, n);
  return { ...json, users, coverage };
}

const FLICKR_BASE58 = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

/** macro_uuid::ShortUuidConverter::from_uuid: the task id github_pr_tasks stores. */
export function shortUuid(uuid: string): string {
  let n = BigInt(`0x${uuid.replace(/-/g, '')}`);
  let out = '';
  while (n > 0n) {
    out = FLICKR_BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

/**
 * Links pull requests to tasks (github_pr_tasks, as the GitHub sync writes
 * them) and to agent sessions that opened them (pull_request_url, source
 * Agent), so the PR links panel reads tasks and opener sessions through Soup.
 * Some links point at tasks the reader cannot see, or that are deleted.
 */
export async function linkPullRequests(args: { instance: string; rng: Rng; entities: Ent[]; coverage: Coverage }) {
  const { rng, entities, coverage } = args;
  const prs = entities.filter((e) => e.kind === 'pr');
  const tasks = entities.filter((e) => e.kind === 'task');
  const sessions = entities.filter((e) => e.kind === 'session');
  const rows: string[] = [];
  const linked = rng.sample(prs, Math.ceil(prs.length / 2));
  for (const pr of linked) {
    for (const task of rng.sample(tasks, rng.int(1, 3))) {
      rows.push(
        `INSERT INTO github_pr_tasks (id, github_key, task_id) VALUES (gen_random_uuid(), ${lit(pr.id)}, ${lit(shortUuid(task.id))}) ON CONFLICT DO NOTHING;`
      );
      coverage.hit('pr-link', `task:${task.owner}:${task.access}`);
    }
  }
  for (const [i, session] of rng.sample(sessions, Math.min(sessions.length, Math.ceil(linked.length / 2))).entries()) {
    const pr = linked[i % linked.length];
    if (!pr) break;
    // As the harness records a PR its agent opened (outbound/postgres/pull_request.rs),
    // or a person linked by hand.
    const source = i % 3 === 2 ? 'user' : 'agent';
    rows.push(
      `UPDATE agent_session SET pull_request_url = ${lit(`https://github.com/${pr.id}`)} WHERE id = ${lit(session.id)};`,
      `INSERT INTO agent_session_pull_request (agent_session_id, github_key, source) VALUES (${lit(session.id)}, ${lit(pr.id)}, ${lit(source)}) ON CONFLICT DO NOTHING;`
    );
    coverage.hit('pr-link', `session:${session.owner}:${source}`);
  }
  if (rows.length) await sql(args.instance, rows.join('\n'));
}
