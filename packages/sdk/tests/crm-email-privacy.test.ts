import { afterEach, expect, test } from 'bun:test';
import type {
  EmailPolicyAudit,
  EmailPolicyOutcome,
  EmailPolicyView,
  EmailPreviewView,
  EmailPrivacySettings,
  EmailRuleSet,
} from '../generated/storage/types.gen';
import {
  type CrmEmailPolicyToken,
  type CrmEmailRuleSet,
  Macro,
} from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const token: CrmEmailPolicyToken = {
  kind: 'policy',
  authority_fingerprint: 'authority',
  consent_incarnation: '00000000-0000-4000-8000-000000000001',
  policy_version: 4,
};
const idempotencyKey = '00000000-0000-4000-8000-000000000002';
const policy: EmailPolicyView = {
  authoring_available: true,
  effect: 'Whole threads; live targets; exclusions win.',
  enabled: true,
  mode: 'selected',
  link_id: 'inbox',
  mailbox_email: 'member@example.com',
  revision: 2,
  rules: { schema_version: 1, include: [] },
  token,
};
const outcome: EmailPolicyOutcome = {
  audit_event_id: 'event',
  effect: 'Eligible whole threads are shared; records remain.',
  enabled: true,
  mode: 'selected',
  replayed: false,
  revision: 3,
  token: { ...token, policy_version: 5 },
};
const preview: EmailPreviewView = {
  preview_id: 'preview-old',
  context_id: 'context-old',
  counts: {
    current: 12,
    proposed: 7,
    added: 2,
    removed: 7,
    retained: 5,
    denied: 3,
  },
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2026-01-01T00:05:00Z',
  as_of: '2026-01-01T00:00:01Z',
  scanned_threads: 10000,
  status: 'partial',
};
const privacy: EmailPrivacySettings = {
  enabled: false,
  mailbox_link_id: 'inbox',
  mailbox_email: 'member@example.com',
  personal_domains: ['private.example'],
  team_domains: ['blocked.example'],
  personal_domain_warnings: {},
  team_domain_warnings: {},
  can_remove_team_domains: false,
};

function client(respond: (request: Request) => Response | Promise<Response>) {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      return respond(input instanceof Request ? input : new Request(input));
    },
    { preconnect: originalFetch.preconnect },
  );
  return new Macro({
    token: 'fixture',
    hosts: { storage: 'https://storage.test' },
  });
}

test('inspection with the gate off is read-only and does not fetch rule targets', async () => {
  const requests: string[] = [];
  const macro = client((request) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json({
      ...policy,
      authoring_available: false,
      token: null,
      rules: {
        schema_version: 1,
        include: [{ kind: 'contact', contact_id: 'contact' }],
      },
    });
  });
  const state = await macro.crm.emailPrivacy.get();
  expect(state.authoringAvailable).toBe(false);
  expect(state.token).toBeUndefined();
  expect(state.inbox?.id).toBe('inbox');
  expect(state.rules?.include[0]).toMatchObject({
    kind: 'contact',
    contact: { id: 'contact' },
  });
  expect(requests).toEqual(['GET /crm/email-privacy/policy']);
  expect(JSON.stringify(state)).not.toContain('fixture');
});

test('validation preserves all five selectors and live references without fetching their contents', async () => {
  const requests: { path: string; body: unknown }[] = [];
  const canonical: EmailRuleSet = {
    schema_version: 1,
    include: [
      { kind: 'thread', thread_id: 'thread' },
      { kind: 'address', address: 'person@example.com' },
      { kind: 'contact', contact_id: 'contact' },
      { kind: 'domain', domain: 'example.com' },
      { kind: 'company', company_id: 'company' },
    ],
  };
  const macro = client(async (request) => {
    requests.push({
      path: new URL(request.url).pathname,
      body: await request.json(),
    });
    return Response.json({
      rules: canonical,
      effect: 'Live references.',
      broad_rule_indices: [3],
      inactive_rule_indices: [2],
    });
  });
  const rules: CrmEmailRuleSet = {
    schemaVersion: 1,
    include: [
      { kind: 'thread', thread: macro.email.byId('thread') },
      { kind: 'address', address: 'Person@EXAMPLE.COM' },
      { kind: 'contact', contact: macro.crm.contactById('contact') },
      { kind: 'domain', domain: 'EXAMPLE.COM' },
      { kind: 'company', company: macro.crm.companyById('company') },
    ],
  };
  const checked = await macro.crm.emailPrivacy.validateRules(rules);
  expect(requests).toEqual([
    {
      path: '/crm/email-privacy/policy/validate',
      body: {
        schema_version: 1,
        include: [
          canonical.include[0],
          { kind: 'address', address: 'Person@EXAMPLE.COM' },
          canonical.include[2],
          { kind: 'domain', domain: 'EXAMPLE.COM' },
          canonical.include[4],
        ],
      },
    },
  ]);
  expect(checked.broadRuleIndices).toEqual([3]);
  expect(checked.inactiveRuleIndices).toEqual([2]);
  expect(checked.rules.include[1]).toEqual({
    kind: 'address',
    address: 'person@example.com',
  });
  expect(checked.rules.include[2]).toMatchObject({
    kind: 'contact',
    contact: { id: 'contact' },
  });
  expect(checked.rules.include[4]).toMatchObject({
    kind: 'company',
    company: { id: 'company' },
  });
});

test('activation repeats the exact command and reports a replay without treating it as current state', async () => {
  const bodies: unknown[] = [];
  const methods: string[] = [];
  const macro = client(async (request) => {
    methods.push(request.method);
    bodies.push(await request.json());
    return Response.json({ ...outcome, replayed: bodies.length === 2 });
  });
  const rules: CrmEmailRuleSet = {
    schemaVersion: 1,
    include: [{ kind: 'domain', domain: 'example.com' }],
  };
  const first = await macro.crm.emailPrivacy.replaceRules(rules, {
    ifPolicy: token,
    idempotencyKey,
  });
  const retry = await macro.crm.emailPrivacy.replaceRules(rules, {
    ifPolicy: token,
    idempotencyKey,
  });
  expect(bodies).toEqual([
    {
      change: {
        action: 'replace_rules',
        rules: { schema_version: 1, include: rules.include },
      },
      if_policy: token,
      request_id: idempotencyKey,
    },
    bodies[0],
  ]);
  expect(methods).toEqual(['PUT', 'PUT']);
  expect(first.replayed).toBe(false);
  expect(retry.replayed).toBe(true);
  expect(retry.token).toEqual(outcome.token);
  expect(retry.revision?.id).toBe('3');
});

test.each([
  409, 403, 503, 429,
])('sharing failure %i is preserved without a fresh inspection or retry', async (status) => {
  const requests: string[] = [];
  const macro = client((request) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json(
      { message: 'The sharing decision cannot be applied.' },
      { status },
    );
  });
  await expect(
    macro.crm.emailPrivacy.replaceRules(
      { schemaVersion: 1, include: [] },
      {
        ifPolicy: token,
        idempotencyKey,
      },
    ),
  ).rejects.toMatchObject({
    status,
    data: { message: 'The sharing decision cannot be applied.' },
  });
  expect(requests).toEqual(['PUT /crm/email-privacy/policy']);
});

test('untyped unknown rule and mutation options fail before any network request', async () => {
  let calls = 0;
  const macro = client(() => {
    calls++;
    return Response.json(outcome);
  });
  const rule = {
    kind: 'address' as const,
    address: 'person@example.com',
    exclude: true,
  };
  await expect(
    macro.crm.emailPrivacy.validateRules({ schemaVersion: 1, include: [rule] }),
  ).rejects.toThrow('exclude');
  const options = { ifPolicy: token, idempotencyKey, confirm: false };
  await expect(
    macro.crm.emailPrivacy.replaceRules(
      { schemaVersion: 1, include: [] },
      options,
    ),
  ).rejects.toThrow('confirm');
  expect(calls).toBe(0);
});

test('an unknown untyped rule kind is rejected before sending a sharing request', async () => {
  let calls = 0;
  const macro = client(() => {
    calls++;
    return Response.json(outcome);
  });
  const rules = JSON.parse(
    '{"schemaVersion":1,"include":[{"kind":"future_rule"}]}',
  );
  await expect(
    macro.crm.emailPrivacy.replaceRules(rules, {
      ifPolicy: token,
      idempotencyKey,
    }),
  ).rejects.toMatchObject({
    name: 'MacroError',
    message: 'Unknown email inclusion rule kind.',
  });
  expect(calls).toBe(0);
});

test('an unknown server rule kind is rejected without fetching target content', async () => {
  const requests: string[] = [];
  const macro = client((request) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json({
      ...policy,
      rules: { schema_version: 1, include: [{ kind: 'future_rule' }] },
    });
  });
  await expect(macro.crm.emailPrivacy.get()).rejects.toMatchObject({
    name: 'MacroError',
    message: 'Unknown email inclusion rule kind.',
  });
  expect(requests).toEqual(['GET /crm/email-privacy/policy']);
});

test('preview replacement carries the exact prior slot and preserves partial counts', async () => {
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const macro = client(async (request) => {
    const body = request.method === 'POST' ? await request.json() : undefined;
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body,
    });
    return Response.json(
      request.method === 'POST'
        ? { ...preview, preview_id: 'preview-new' }
        : preview,
    );
  });
  const old = await macro.crm.emailPrivacy.preview();
  const started = await macro.crm.emailPrivacy.previewRules(
    { schemaVersion: 1, include: [] },
    {
      ifPolicy: token,
      ifPreview: old,
    },
  );
  expect(started.id).toBe('preview-new');
  expect(started.toJSON()).toMatchObject({
    status: 'partial',
    counts: preview.counts,
    scannedThreads: 10000,
  });
  expect(requests).toEqual([
    {
      method: 'GET',
      path: '/crm/email-privacy/policy/preview',
      body: undefined,
    },
    {
      method: 'POST',
      path: '/crm/email-privacy/policy/preview',
      body: {
        if_policy: token,
        if_preview_id: 'preview-old',
        rules: { schema_version: 1, include: [] },
      },
    },
  ]);
});

test('a superseded preview cannot read or cancel its replacement', async () => {
  const requests: string[] = [];
  let reads = 0;
  const macro = client((request) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    reads++;
    return Response.json(
      reads === 1
        ? preview
        : { ...preview, preview_id: 'preview-new', status: 'complete' },
    );
  });
  const old = await macro.crm.emailPrivacy.preview();
  expect(old).toBeDefined();
  await expect(old?.get()).rejects.toMatchObject({
    name: 'MacroNotFoundError',
  });
  await old?.cancel();
  expect(requests).toEqual([
    'GET /crm/email-privacy/policy/preview',
    'GET /crm/email-privacy/policy/preview',
    'DELETE /crm/email-privacy/policy/preview/preview-old',
  ]);
  expect(old?.toJSON()).toEqual({ id: 'preview-old' });
});

test('a late preview read cannot restore cached progress after cancellation', async () => {
  let releaseRead: (response: Response) => void = () => {
    throw new Error('Read not started');
  };
  const heldRead = new Promise<Response>((resolve) => {
    releaseRead = resolve;
  });
  let markReadStarted: () => void = () => {
    throw new Error('Read not started');
  };
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve;
  });
  let reads = 0;
  const macro = client((request) => {
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    reads++;
    if (reads === 1) return Response.json(preview);
    markReadStarted();
    return heldRead;
  });
  const handle = await macro.crm.emailPrivacy.preview();
  if (!handle) throw new Error('Missing preview');
  const pending = handle.get();
  await readStarted;
  await handle.cancel();
  releaseRead(Response.json(preview));
  await pending;
  expect(handle.toJSON()).toEqual({ id: 'preview-old' });
});

test('history is lazy, advances its cursor and fetches saved definitions only on request', async () => {
  const requests: string[] = [];
  const event: EmailPolicyAudit = {
    consent_incarnation: token.consent_incarnation,
    policy_version: 4,
    link_id: 'inbox',
    created_at: '2026-01-01T00:00:00Z',
    entry: {
      action: 'rules_activated',
      actor_kind: 'agent',
      agent_id: 'agent',
      agent_session_id: 'session',
      event_id: 'event-2',
      previous_revision: 1,
      next_revision: 2,
      details: {},
    },
  };
  const macro = client((request) => {
    const url = new URL(request.url);
    requests.push(url.pathname + url.search);
    if (url.pathname.endsWith('/revisions/2'))
      return Response.json({
        revision: 2,
        created_at: event.created_at,
        link_id: 'inbox',
        rules: {
          schema_version: 1,
          include: [{ kind: 'contact', contact_id: 'hidden-contact' }],
        },
      });
    if (url.searchParams.has('before'))
      return Response.json({
        events: [{ ...event, entry: { ...event.entry, event_id: 'event-1' } }],
        next_cursor: null,
      });
    return Response.json({ events: [event], next_cursor: 'event-2' });
  });
  const history = macro.crm.emailPrivacy.history();
  expect(requests).toEqual([]);
  const events = [];
  for await (const entry of history) events.push(entry);
  expect(events.map((entry) => entry.id)).toEqual(['event-2', 'event-1']);
  expect(requests).toEqual([
    '/crm/email-privacy/policy/history',
    '/crm/email-privacy/policy/history?before=event-2',
  ]);
  expect(events[0]?.agent?.id).toBe('agent');
  expect(events[0]?.agentSession?.id).toBe('session');
  const saved = await events[0]?.nextRevision?.get();
  expect(saved?.rules.include[0]).toMatchObject({
    kind: 'contact',
    contact: { id: 'hidden-contact' },
  });
  expect(requests.at(-1)).toBe('/crm/email-privacy/policy/revisions/2');
  expect(JSON.stringify(events)).not.toContain('fixture');
});

test('breaking a history iterator does not prefetch another page', async () => {
  let calls = 0;
  const macro = client(() => {
    calls++;
    return Response.json({
      events: [
        {
          created_at: '2026-01-01T00:00:00Z',
          link_id: 'inbox',
          policy_version: 1,
          entry: {
            action: 'withdrawn',
            actor_kind: 'member',
            event_id: 'event',
            details: {},
          },
        },
      ],
      next_cursor: 'event',
    });
  });
  for await (const _entry of macro.crm.emailPrivacy.history()) break;
  expect(calls).toBe(1);
});

test('legacy gate-off withdrawal remains on the existing consent API', async () => {
  const bodies: unknown[] = [];
  const paths: string[] = [];
  const macro = client(async (request) => {
    paths.push(new URL(request.url).pathname);
    bodies.push(await request.json());
    return Response.json(privacy);
  });
  const result = await macro.crm.emailPrivacy.setConsent(false);
  expect(result.enabled).toBe(false);
  expect(result.inbox?.id).toBe('inbox');
  expect(bodies).toEqual([{ action: 'set_consent', enabled: false }]);
  expect(paths).toEqual(['/crm/email-privacy']);
  await expect(macro.crm.emailPrivacy.setConsent(true)).rejects.toThrow(
    'primary inbox',
  );
  expect(bodies).toHaveLength(1);
});

test('mode changes and withdrawal preserve the original policy observation', async () => {
  const bodies: unknown[] = [];
  const macro = client(async (request) => {
    bodies.push(await request.json());
    return Response.json(outcome);
  });
  const options = { ifPolicy: token, idempotencyKey };
  await macro.crm.emailPrivacy.enableAll(options);
  await macro.crm.emailPrivacy.withdraw({
    ...options,
    idempotencyKey: '00000000-0000-4000-8000-000000000003',
  });
  expect(bodies).toEqual([
    {
      change: { action: 'enable_all' },
      if_policy: token,
      request_id: idempotencyKey,
    },
    {
      change: { action: 'withdraw' },
      if_policy: token,
      request_id: '00000000-0000-4000-8000-000000000003',
    },
  ]);
});

test('private exceptions use mailbox-local handles and personal domain scope', async () => {
  const bodies: unknown[] = [];
  const requests: string[] = [];
  const macro = client(async (request) => {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/threads'))
      return Response.json({
        threads: [{ thread_id: 'thread', link_id: 'inbox', subject: null }],
        next_cursor: null,
      });
    if (request.method === 'PUT') bodies.push(await request.json());
    return Response.json(privacy);
  });
  const settings = await macro.crm.emailPrivacy.settings();
  expect(settings.personalDomains).toEqual(['private.example']);
  const threads = [];
  for await (const thread of macro.crm.emailPrivacy.excludedThreads())
    threads.push(thread);
  expect(threads[0]?.thread.id).toBe('thread');
  expect(threads[0]?.subject).toBeUndefined();
  await macro.crm.emailPrivacy.setThreadExcluded(
    macro.email.byId('thread'),
    true,
  );
  await macro.crm.emailPrivacy.blockDomain('private.example');
  await macro.crm.emailPrivacy.unblockDomain('private.example');
  expect(bodies).toEqual([
    { action: 'set_thread_exclusion', thread_id: 'thread', excluded: true },
    { action: 'add_domain', scope: 'personal', domain: 'private.example' },
    { action: 'remove_domain', scope: 'personal', domain: 'private.example' },
  ]);
  expect(requests.every((path) => path.includes('/crm/email-privacy'))).toBe(
    true,
  );
});
