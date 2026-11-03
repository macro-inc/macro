import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '../../apps/web/src/features/property/identifiers';
import { MACRO_NEW_BOT_ID } from '../../apps/web/src/lib/core/constant/macroNew';
import type {
  CellWrite,
  DatabaseOp,
} from '../../apps/web/src/lib/core/database-sql/generated/types';
import type { CreateAgentSessionRequest } from '../../apps/web/src/lib/service-clients/service-agent-harness/generated/schemas/createAgentSessionRequest';
import type {
  CreateMarkdownDocumentRequest,
  CreateTaskRequest,
  PostMessage,
} from '../../packages/sdk/generated/storage/types.gen';
import { PerformanceJournal } from './performance-journal';

const sizes = {
  smoke: {
    folders: 3,
    projects: 2,
    documents: 3,
    tasks: 2,
    messages: 10,
    rows: 100,
    sessions: 1,
  },
  small: {
    folders: 10,
    projects: 3,
    documents: 30,
    tasks: 15,
    messages: 50,
    rows: 100,
    sessions: 2,
  },
  large: {
    folders: 500,
    projects: 30,
    documents: 3000,
    tasks: 1500,
    messages: 5000,
    rows: 10000,
    sessions: 50,
  },
};
const { values } = parseArgs({
  options: {
    origin: { type: 'string' },
    email: { type: 'string' },
    manifest: { type: 'string' },
    size: { type: 'string', default: 'smoke' },
    concurrency: { type: 'string', default: '2' },
    help: { type: 'boolean' },
  },
});
if (values.help || !values.origin || !values.email || !values.manifest) {
  console.log(
    'Usage: bun tooling/seed_cli/seed-performance.ts --origin https://localhost:<port> --email <local-persona> --manifest <outside-repo-path> --size smoke|small|large [--concurrency 2]'
  );
  process.exit(values.help ? 0 : 1);
}
const origin = new URL(values.origin);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
  origin.pathname !== '/' ||
  !['http:', 'https:'].includes(origin.protocol) ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash
)
  throw new Error('Performance fixtures require a loopback backend origin');
const size = values.size;
if (size !== 'smoke' && size !== 'small' && size !== 'large')
  throw new Error('Unknown size');
const target = sizes[size];
const concurrency = Number(values.concurrency);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
  throw new Error('Concurrency must be between 1 and 4');
const manifest = resolve(values.manifest);
if (manifest.startsWith(`${resolve(import.meta.dir, '../..')}/`))
  throw new Error('Keep the fixture manifest outside the checkout');
mkdirSync(dirname(manifest), { recursive: true, mode: 0o700 });
const lock = `${manifest}.lock`;
const lockFd = openSync(lock, 'wx', 0o600);
writeFileSync(lockFd, String(process.pid));
closeSync(lockFd);
let accessToken: string | undefined;
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});

async function send<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    tls: { rejectUnauthorized: false },
    signal: AbortSignal.timeout(60_000),
    redirect: 'error',
  }).catch(() => {
    throw new Error('Seed API transport failed; request outcome unknown');
  });
  // Auth response bodies/paths may contain credentials. Never print either.
  if (!response.ok)
    throw new Error(`Seed API returned HTTP ${response.status}`);
  try {
    return JSON.parse((await response.text()) || 'null');
  } catch {
    throw new Error(
      'Seed API response could not be read; request outcome unknown'
    );
  }
}

try {
  const email = values.email.toLowerCase();
  const login = await send<{ code?: string }>(
    'POST',
    '/auth/login/passwordless',
    { email, redirect_uri: `${origin.origin}/app/home` }
  );
  if (!login.code)
    throw new Error('Local passwordless code missing; nothing seeded');
  const tokens = await send<{ access_token: string }>(
    'GET',
    `/auth/oauth/passwordless/${encodeURIComponent(login.code)}?email=${encodeURIComponent(email)}&disable_redirect=true`
  );
  if (!tokens.access_token) throw new Error('Local access token missing');
  accessToken = tokens.access_token;
  const user = await send<{ user_id: string }>('GET', '/auth/user/me');
  if (!user.user_id) throw new Error('Authenticated identity missing');
  const identity = createHash('sha256')
    .update(`v1:${origin.origin}:${user.user_id}`)
    .digest('hex');
  const journal = new PerformanceJournal(`${manifest}.jsonl`, identity);
  const label = `Perf Scale ${journal.dataset.slice(-8)}`;
  const blocked: string[] = [];
  const id = (key: string) => {
    const value = journal.completed.get(key);
    if (!value) throw new Error(`Missing fixture prerequisite: ${key}`);
    return value;
  };
  const name = (kind: string, index = 0) =>
    `${label} ${kind} ${String(index).padStart(4, '0')}`;
  function snapshot() {
    writeFileSync(
      `${manifest}.tmp`,
      JSON.stringify(
        {
          version: 1,
          origin: origin.origin,
          dataset: journal.dataset,
          label,
          target,
          completed: Object.fromEntries(journal.completed),
          pending: [...journal.pending],
          blocked,
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    renameSync(`${manifest}.tmp`, manifest);
  }
  async function group(
    kind: string,
    count: number,
    create: (index: number) => Promise<string>
  ) {
    if (stopping || blocked.length) return;
    let next = 0;
    let failure: unknown;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (!stopping && !failure && next < count) {
          const index = next++;
          try {
            await journal.create(`${kind}.${index}`, () => create(index));
          } catch (error) {
            failure = error;
          }
        }
      })
    );
    if (failure)
      blocked.push(
        `${kind}: ${failure instanceof Error ? failure.message : 'request failed'}`
      );
    snapshot();
    console.log(
      `${kind}: ${[...journal.completed.keys()].filter((key) => key.startsWith(`${kind}.`)).length}/${count}${failure ? ' (blocked; see manifest)' : ''}`
    );
  }
  const createFolder = async (index: number, parent: string | null) => {
    const result = await send<{ data: { id: string } }>(
      'POST',
      '/dss/projects',
      { name: name('Folder', index), projectParentId: parent }
    );
    return result.data.id;
  };
  await group('folder', Math.min(target.folders, 250), (index) =>
    createFolder(index, null)
  );
  await group('subfolder', Math.max(0, target.folders - 250), (index) =>
    createFolder(index + 250, id(`folder.${index % 250}`))
  );
  const folder = (index: number) => {
    const selected = index % target.folders;
    return id(
      selected < 250 ? `folder.${selected}` : `subfolder.${selected - 250}`
    );
  };
  await group('project', target.projects, async (index) => {
    const result = await send<{ id: string }>('POST', '/dss/initiatives', {
      name: name('Project', index),
      shareWithTeam: false,
      memberIds: [],
    });
    return result.id;
  });
  await group('document', target.documents, async (index) => {
    const body: CreateMarkdownDocumentRequest = {
      documentName: name('Document', index),
      markdown: `# Scale document ${index}\n\nSynthetic fixture ${index}.\n\n- Planning notes\n- Follow-up work\n\n${'A reusable local performance fixture. '.repeat(12)}`,
      projectId: folder(index),
    };
    return (
      await send<{ documentId: string }>(
        'POST',
        '/dss/documents/create_markdown',
        body
      )
    ).documentId;
  });
  await group('task', target.tasks, async (index) => {
    const statuses = Object.values(PROPERTY_OPTION_IDS.STATUS);
    const priorities = Object.values(PROPERTY_OPTION_IDS.PRIORITY);
    const body: CreateTaskRequest = {
      taskName: name('Task', index),
      markdown: `Synthetic task ${index}.\n\n- [ ] Investigate\n- [ ] Implement\n- [ ] Verify`,
      shareWithTeam: false,
      projectId: folder(index),
      propertyValues: [
        {
          propertyId: SYSTEM_PROPERTY_IDS.STATUS,
          value: {
            type: 'select_option',
            option_id: statuses[index % statuses.length],
          },
        },
        {
          propertyId: SYSTEM_PROPERTY_IDS.PRIORITY,
          value: {
            type: 'select_option',
            option_id: priorities[index % priorities.length],
          },
        },
        {
          propertyId: SYSTEM_PROPERTY_IDS.PROJECT,
          value: {
            type: 'entity_reference',
            reference: {
              entity_type: 'INITIATIVE',
              entity_id: id(`project.${index % target.projects}`),
            },
          },
        },
        {
          propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
          value: {
            type: 'multi_entity_reference',
            references:
              index % 4
                ? [{ entity_type: 'USER', entity_id: user.user_id }]
                : [],
          },
        },
        {
          propertyId: SYSTEM_PROPERTY_IDS.DUE_DATE,
          value: {
            type: 'date',
            value: new Date(Date.UTC(2026, 10, 1 + (index % 60))).toISOString(),
          },
        },
      ],
    };
    return (
      await send<{ documentId: string }>(
        'POST',
        '/dss/documents/create_task',
        body
      )
    ).documentId;
  });
  await group(
    'long-document',
    1,
    async () =>
      (
        await send<{ documentId: string }>(
          'POST',
          '/dss/documents/create_markdown',
          {
            documentName: name('Long document'),
            projectId: id('folder.0'),
            markdown: Array.from(
              { length: 2000 },
              (_, index) =>
                `Paragraph ${index + 1}. ${'Synthetic long-document content with enough text to wrap across multiple lines. '.repeat(3)}`
            ).join('\n\n'),
          }
        )
      ).documentId
  );
  await group(
    'channel',
    1,
    async () =>
      (
        await send<{ id: string }>('POST', '/dss/channels', {
          channel_type: 'private',
          name: name('Channel'),
          participants: [],
        })
      ).id
  );
  // Twenty replies per thread; all roots finish before their replies start.
  const post = async (index: number, thread: string | null) => {
    const body: PostMessage = {
      id: Bun.randomUUIDv7(),
      content: `Scale message ${index}: ${'Synthetic discussion content. '.repeat(4)}`,
      thread_id: thread,
      mentions: [],
      attachments: [],
    };
    return (
      await send<{ id: string }>(
        'POST',
        `/dss/messages/channel/${id('channel.0')}`,
        body
      )
    ).id;
  };
  await group('root-message', Math.ceil(target.messages * 0.8), (index) =>
    post(index, null)
  );
  await group(
    'reply',
    target.messages - Math.ceil(target.messages * 0.8),
    (index) => post(index, id(`root-message.${Math.floor(index / 20)}`))
  );
  await group('session', target.sessions, async () => {
    const body: CreateAgentSessionRequest = {
      id: Bun.randomUUIDv7(),
      botId: MACRO_NEW_BOT_ID,
    };
    const result = await send<{ session: { id: string } }>(
      'POST',
      '/agent-harness/agent-sessions',
      body
    );
    return result.session.id;
  });
  await group('session-name', target.sessions, async (index) => {
    const session = id(`session.${index}`);
    await send('PUT', `/agent-harness/agent-sessions/${session}/name`, {
      name: name('Session', index),
    });
    return session;
  });
  await group(
    'database',
    1,
    async () =>
      (
        await send<{ id: string }>('POST', '/dss/databases', {
          name: name('Database'),
        })
      ).id
  );
  await group('table', 1, async () => {
    const table = Bun.randomUUIDv7();
    const columns = Array.from({ length: 6 }, () => Bun.randomUUIDv7());
    const ops: DatabaseOp[] = [
      { kind: 'table', table, change: { kind: 'create', name: 'Records' } },
      ...columns.map(
        (column, index): DatabaseOp => ({
          kind: 'column',
          table,
          column,
          change: {
            kind: 'create',
            definition: {
              source: 'new',
              name: [
                'Name',
                'Summary',
                'Category',
                'Status',
                'Estimate',
                'Score',
              ][index],
              type: index < 4 ? { type: 'text' } : { type: 'number' },
            },
          },
        })
      ),
    ];
    await send('POST', `/dss/databases/${id('database.0')}/ops`, { ops });
    return JSON.stringify({ table, columns });
  });
  await group('rows', Math.ceil(target.rows / 100), async (index) => {
    const schema: { table: string; columns: string[] } = JSON.parse(
      id('table.0')
    );
    const count = Math.min(100, target.rows - index * 100);
    const rows = Array.from({ length: count }, (_, offset): CellWrite[] => {
      const row = index * 100 + offset;
      return schema.columns.map((column, field) => ({
        column,
        value:
          field < 4
            ? {
                type: 'text',
                value: [
                  name('Record', row),
                  `Synthetic row ${row} with a longer description`,
                  `Category ${row % 12}`,
                  ['Planned', 'Active', 'Review', 'Done'][row % 4],
                ][field],
              }
            : {
                type: 'number',
                value: field === 4 ? row % 80 : (row * 17) % 1000,
              },
      }));
    });
    const ops: DatabaseOp[] = [
      { kind: 'rows', table: schema.table, change: { kind: 'insert', rows } },
    ];
    await send('POST', `/dss/databases/${id('database.0')}/ops`, { ops });
    return String(count);
  });
  snapshot();
  if (blocked.length || stopping) process.exitCode = 1;
  console.log(
    `Manifest: ${manifest}. No existing content was modified; no models were prompted.`
  );
} finally {
  unlinkSync(lock);
}
