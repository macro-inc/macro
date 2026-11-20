import { expect, type Page, type TestInfo, test } from '@playwright/test';

type Agent = {
  userId: string;
  teamId: string;
  name: string;
  jobDescription: string;
  personality: string;
  createdBy: string | null;
  computerId: string | null;
  status:
    | 'provisioning'
    | 'starting'
    | 'running'
    | 'paused'
    | 'failed'
    | 'released';
  createdAt: string;
};

type SetupStep = 'billing' | 'creating' | 'booting' | 'connecting';

const OWNER = 'macro|maya@example.com';
const MEMBER = 'macro|sam@example.com';
const ADA = 'macro|ada@agents.macro.invalid';

/** Where to also copy every screenshot, for a PR; unset keeps them in test-results. */
const screenshotDirectory = process.env.TEAM_AGENTS_SCREENSHOT_DIR;

const OFFERS = [
  {
    size: 'standard',
    vcpus: 4,
    memoryGb: 8,
    diskGb: 100,
    soldOut: false,
    quote: {
      size: 'standard',
      amount: 4000,
      currency: 'usd',
      interval: 'month',
      priceId: 'price_standard',
    },
  },
  {
    size: 'large',
    vcpus: 8,
    memoryGb: 16,
    diskGb: 200,
    soldOut: false,
    quote: {
      size: 'large',
      amount: 8000,
      currency: 'usd',
      interval: 'month',
      priceId: 'price_large',
    },
  },
  {
    size: 'xl',
    vcpus: 16,
    memoryGb: 32,
    diskGb: 400,
    soldOut: true,
    quote: {
      size: 'xl',
      amount: 16000,
      currency: 'usd',
      interval: 'month',
      priceId: 'price_xl',
    },
  },
];

const VOICES = [
  {
    model: 'aura-2-arcas-en',
    name: 'Arcas',
    accent: 'American',
    tags: ['masculine', 'confident'],
    languages: ['en'],
  },
  {
    model: 'aura-2-thalia-en',
    name: 'Thalia',
    accent: 'American',
    tags: ['feminine', 'warm'],
    languages: ['en'],
  },
];

/** A header-only WAV: mono PCM16 at 24 kHz with no samples. */
const SILENT_WAV = Buffer.from(
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAAAAA=',
  'base64'
);

/** Ada, already invited, in the state a test starts from. */
function ada(status: Agent['status']): Agent {
  return {
    userId: ADA,
    teamId: 'team-1',
    name: 'Ada',
    jobDescription: 'Triage new support emails and draft replies for review.',
    personality: 'Warm and concise. Asks before guessing.',
    createdBy: OWNER,
    computerId: 'computer-ada',
    status,
    createdAt: '2026-11-11T09:00:00Z',
  };
}

/**
 * The services the page talks to: the roster, the computer catalog and
 * list, `/team_agents` with its voices, and the agent harness's runtimes.
 * A new agent reports `provisioning` until the list has been read
 * `provisioningReads` more times, then `running`; its computer reports
 * `backend.step` meanwhile.
 */
async function scriptAuthService(
  page: Page,
  provisioningReads = 2,
  options: {
    agents?: Agent[];
    failedVoiceSaves?: number;
    /** Invites the server refuses before one goes through, and how. */
    failedCreates?: number;
    refusal?: 'payment_declined' | 'no_room';
    /** Whether macrod on an agent's computer has connected. */
    computerConnected?: boolean;
    /** Owners and admins own an agent computer's runtime; others don't see it. */
    viewerOwnsRuntimes?: boolean;
    failedCrmSaves?: number;
    extraMembers?: { user_id: string; role: 'admin' | 'member' }[];
  } = {}
) {
  const backend = {
    agents: [...(options.agents ?? [])],
    created: [] as unknown[],
    removed: [] as string[],
    retries: [] as string[],
    reads: 0,
    // The read on which an agent's computer came up.
    startedAt: 0,
    step: 'creating' as SetupStep,
    voices: {} as Record<string, string>,
    voiceSaves: [] as unknown[],
    failedVoiceSaves: options.failedVoiceSaves ?? 0,
    failedCreates: options.failedCreates ?? 0,
    samples: [] as string[],
    computerConnected: options.computerConnected ?? false,
    // The agent computer's Claude: its mode, and the sign-in calls it saw.
    claude: { mode: 'macro_credits' } as {
      mode: 'macro_credits' | 'own_account';
      account?: { signedInAt: string; signedInBy: string };
    },
    claudeCalls: [] as string[],
    claudeCodes: [] as string[],
    crmAccess: { [OWNER]: true, [MEMBER]: true } as Record<string, boolean>,
    crmSaves: [] as { user_id: string; enabled: boolean }[],
    failedCrmSaves: options.failedCrmSaves ?? 0,
  };
  const viewerOwnsRuntimes = options.viewerOwnsRuntimes ?? true;
  const members = () => [
    { user_id: OWNER, role: 'owner', team_id: 'team-1', plan: 'premium' },
    { user_id: MEMBER, role: 'member', team_id: 'team-1', plan: 'premium' },
    ...(options.extraMembers ?? []).map((member) => ({
      ...member,
      team_id: 'team-1',
      plan: 'premium',
    })),
    // The server adds an agent's own account to the team.
    ...backend.agents.map((agent) => ({
      user_id: agent.userId,
      role: 'member',
      team_id: 'team-1',
      plan: 'premium',
    })),
  ];
  // Each agent's computer, as the team's computer list reports it.
  const computer = (agent: Agent) => ({
    id: agent.computerId,
    name: agent.name,
    size: 'standard',
    vcpus: 4,
    memoryGib: 8,
    diskGib: 100,
    catalogEntry: 'standard@2026-11',
    status: {
      provisioning: 'setting_up',
      starting: 'ready',
      running: 'ready',
      paused: 'stopped',
      failed: 'failed',
      released: 'released',
    }[agent.status],
    billing: 'active',
    setup:
      agent.status === 'provisioning'
        ? { step: backend.step, position: 1, total: 4 }
        : undefined,
    failureReason:
      agent.status === 'failed'
        ? "The computer couldn't be created on the host."
        : undefined,
    poweredOn: agent.status === 'running' || agent.status === 'starting',
    agentCount: 0,
    canUndoCancel: false,
    canRestore: false,
    purchasedBy: OWNER,
    createdAt: agent.createdAt,
    harnessId: null,
    defaultAgentId: null,
    setupCompletedAt: null,
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!['fetch', 'xhr'].includes(request.resourceType()))
      return route.continue();

    const path = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    if (path.endsWith('/team_agents') && request.method() === 'GET') {
      backend.reads += 1;
      // The computer comes up, then the agent reports itself online two
      // reads later.
      for (const agent of backend.agents) {
        if (
          agent.status === 'starting' &&
          backend.reads > backend.startedAt + 2
        )
          agent.status = 'running';
        if (
          agent.status === 'provisioning' &&
          backend.reads > provisioningReads
        ) {
          agent.status = 'starting';
          backend.startedAt = backend.reads;
        }
      }
      return json(200, { agents: backend.agents });
    }

    if (path.endsWith('/team_agents') && request.method() === 'POST') {
      const body = request.postDataJSON();
      backend.created.push(body);
      if (backend.failedCreates > 0) {
        backend.failedCreates -= 1;
        return options.refusal === 'no_room'
          ? json(409, { message: 'No room', code: 'no_room', size: body.size })
          : json(402, { message: 'Declined', code: 'payment_declined' });
      }
      backend.reads = 0;
      const agent: Agent = {
        userId: `macro|${body.name.toLowerCase()}@agents.macro.invalid`,
        teamId: 'team-1',
        name: body.name,
        jobDescription: body.jobDescription,
        personality: body.personality,
        createdBy: OWNER,
        // The invite answers once its computer is bought.
        computerId: `computer-${body.name.toLowerCase()}`,
        status: 'provisioning',
        createdAt: '2026-11-11T09:00:00Z',
      };
      backend.agents.push(agent);
      return json(201, agent);
    }

    if (path.endsWith('/voices')) return json(200, VOICES);
    const sample = path.match(/\/voices\/([^/]+)\/sample$/);
    if (sample) {
      backend.samples.push(decodeURIComponent(sample[1] ?? ''));
      return route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: SILENT_WAV,
      });
    }

    const voice = path.match(/\/team_agents\/([^/]+)\/voice$/);
    if (voice) {
      const userId = decodeURIComponent(voice[1] ?? '');
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        backend.voiceSaves.push({ userId, ...body });
        if (backend.failedVoiceSaves > 0) {
          backend.failedVoiceSaves -= 1;
          return json(502, { message: 'repository unavailable' });
        }
        backend.voices[userId] = body.model;
        return json(200, body);
      }
      const model = backend.voices[userId];
      // No voice set yet: the agent keeps its template's default.
      return model ? json(200, { model }) : json(404, { message: 'no voice' });
    }

    if (path.includes('/team_agents/') && request.method() === 'DELETE') {
      const userId = decodeURIComponent(path.split('/team_agents/')[1] ?? '');
      backend.removed.push(userId);
      backend.agents = backend.agents.filter(
        (agent) => agent.userId !== userId
      );
      return route.fulfill({ status: 204 });
    }

    if (path.endsWith('/team/computers/rollout'))
      return json(200, { enabled: true });
    if (path.endsWith('/team/computers/offers')) return json(200, OFFERS);

    if (path.endsWith('/team/computers') && request.method() === 'GET')
      return json(
        200,
        backend.agents.filter((agent) => agent.computerId).map(computer)
      );

    // Retry sets the same computer up again; it never buys another.
    const retry = path.match(/\/team\/computers\/([^/]+)\/retry$/);
    if (retry && request.method() === 'POST') {
      const computerId = decodeURIComponent(retry[1] ?? '');
      backend.retries.push(computerId);
      const agent = backend.agents.find(
        (item) => item.computerId === computerId
      );
      if (!agent) return json(404, { message: 'no computer' });
      agent.status = 'provisioning';
      backend.step = 'creating';
      backend.reads = 0;
      return json(200, computer(agent));
    }

    if (path.endsWith('/team') && request.method() === 'PATCH') {
      const change = request.postDataJSON().member_crm_access;
      if (change) {
        backend.crmSaves.push(change);
        if (backend.failedCrmSaves > 0) {
          backend.failedCrmSaves -= 1;
          return json(503, { message: 'Try again.' });
        }
        backend.crmAccess[change.user_id] = change.enabled;
        return json(200, null);
      }
    }

    if (path.endsWith('/team'))
      return json(200, {
        team: {
          id: 'team-1',
          name: 'Northwind',
          slug: 'northwind',
          owner_id: OWNER,
          allow_non_admin_invites: true,
          crm_enabled: false,
          enterprise: false,
        },
        members: members(),
        scheduled_seat_plans: {},
        crm_member_access: backend.crmAccess,
      });

    // Message <name> opens the agent's real DM, made on the spot.
    if (
      path.endsWith('/channels/get_or_create_dm') &&
      request.method() === 'POST'
    )
      return json(200, {
        action: 'created',
        channel_id: `dm-${request.postDataJSON().recipient_id}`,
      });

    // Nothing else is part of this flow.
    return json(404, { message: 'not scripted' });
  });

  // The agent harness and its runtime list: registered last, so tried first.
  await page.route('**/harnesses**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    // macrod enrolls each agent's computer as a runtime its admins own.
    if (path.endsWith('/harnesses') && request.method() === 'GET')
      return json(
        200,
        viewerOwnsRuntimes
          ? backend.agents
              .filter((agent) => agent.status !== 'provisioning')
              .map((agent) => ({
                id: `harness-${agent.name.toLowerCase()}`,
                kind: 'macrod',
                name: agent.name,
                owner: { type: 'user', user_id: agent.userId },
                access: 'owner',
                shared_team_ids: [],
                allow_permission_bypass: false,
                created_by: agent.userId,
                created_at: agent.createdAt,
                updated_at: agent.createdAt,
                connected: backend.computerConnected,
                last_connected_at: null,
                computer_id: `computer-${agent.name.toLowerCase()}`,
                claude_mode: backend.claude.mode,
              }))
          : []
      );

    const claude = path.match(
      /\/harnesses\/([^/]+)\/(claude-sign-in(?:\/complete)?|claude-sign-out|claude-mode)$/
    );
    if (claude) {
      const action = claude[2] ?? '';
      backend.claudeCalls.push(
        `${decodeURIComponent(claude[1] ?? '')} ${action}`
      );
      if (action === 'claude-mode') return json(200, backend.claude);
      if (action === 'claude-sign-in')
        return json(200, {
          url: 'https://claude.com/cai/oauth/authorize?state=scripted',
        });
      if (action === 'claude-sign-in/complete') {
        backend.claudeCodes.push(request.postDataJSON().code);
        backend.claude = {
          mode: 'own_account',
          account: { signedInAt: '2026-11-13T09:00:00Z', signedInBy: OWNER },
        };
        return json(200, { signedIn: true });
      }
      backend.claude = { mode: 'macro_credits' };
      return json(200, backend.claude);
    }

    return route.fallback();
  });

  return backend;
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const file = `${testInfo.project.name}-${name}.png`;
  // Full-page capture temporarily resizes mobile emulation and can switch its
  // pointer mode. Keep the phone capture at the viewport we just verified.
  const fullPage = testInfo.project.name !== 'phone';
  await page.screenshot({ path: testInfo.outputPath(file), fullPage });
  if (screenshotDirectory)
    await page.screenshot({
      path: `${screenshotDirectory}/${file}`,
      fullPage,
    });
}

/** Ada's computer finished setup, or gave up, as the realtime feed says. */
async function notify(page: Page, outcome: 'ready' | 'failed') {
  await page.evaluate(
    (kind) =>
      window.teamAgentsFixture.notify({
        computerId: 'computer-ada',
        harnessId: kind === 'ready' ? 'harness-ada' : null,
        computerName: 'Ada',
        agent: { userId: 'macro|ada@agents.macro.invalid', name: 'Ada' },
        outcome:
          kind === 'ready'
            ? { kind: 'ready' }
            : {
                kind: 'failed',
                failureReason: "The computer couldn't be created on the host.",
              },
      }),
    outcome
  );
}

async function openInviteAgent(page: Page) {
  // The fixture's first, cold load can take longer than an expect's default.
  await expect(
    page.getByText('maya@example.com', { exact: false }).first()
  ).toBeVisible({ timeout: 15_000 });
  // Members' own button for agents; Invite Human opens the people form.
  await expect(
    page.getByRole('button', { name: 'Invite Human' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Invite Agent' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Invite an agent');
  return dialog;
}

async function fillAda(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Ada');
}

test('adding an agent waits in the dialog until it is online, then closes into its DM', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 2);
  await page.goto('/');
  const dialog = await openInviteAgent(page);

  // Disabled, with the reason beside it; a suggestion names it.
  const add = dialog.getByRole('button', { name: /^Add/ });
  await expect(add).toBeDisabled();
  await expect(dialog).toContainText('Give your agent a name to continue.');
  await screenshot(page, testInfo, 'add-agent-empty');
  await dialog.getByRole('button', { name: 'Ada', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Ada'
  );

  // Standard is preselected; XL is sold out. The price is the computer's.
  await expect(dialog.getByRole('radio', { name: 'Standard' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'XL' })).toBeDisabled();
  await dialog.getByText('Large', { exact: true }).click();
  await expect(add).toHaveText('Add Ada · $80.00/month');
  await screenshot(page, testInfo, 'add-agent-named');

  await add.click();
  await expect(
    dialog.getByRole('button', { name: /Adding Ada/ })
  ).toBeVisible();
  await screenshot(page, testInfo, 'add-agent-adding');
  // It closes once the agent reports itself online: no notice, no setup card.
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect(
    page.getByText("Ada is being set up. We'll let you know when it's ready.")
  ).toHaveCount(0);
  expect(backend.claudeCalls).toEqual([]);
  expect(backend.created).toEqual([
    {
      name: 'Ada',
      jobDescription: '',
      personality: '',
      size: 'large',
      avatarUrl: null,
      purchaseKey: expect.any(String),
    },
  ]);

  const agentRow = page.locator('[data-member-kind="agent"]');
  await expect(agentRow).toHaveCount(1);
  await expect(agentRow.getByRole('status')).toHaveText('Running');
  await expect(agentRow.locator('[data-agent-setup-step]')).toHaveCount(0);
  await screenshot(page, testInfo, 'members-online');

  // Removing deletes its computer and files, so it asks first; Cancel keeps it.
  await agentRow.getByRole('button', { name: 'Remove agent' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Remove Ada?');
  await expect(confirm).toContainText(
    "Its computer and files are deleted. This can't be undone."
  );
  await screenshot(page, testInfo, 'remove-agent-confirm');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(agentRow).toHaveCount(1);
  expect(backend.removed).toEqual([]);

  await agentRow.getByRole('button', { name: 'Remove agent' }).click();
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(agentRow).toHaveCount(0);
  expect(backend.removed).toEqual([ADA]);
});

test('an agent still starting after five seconds closes the dialog, and its row shows the setup step', async ({
  page,
}, testInfo) => {
  await scriptAuthService(page, 40);
  await page.goto('/');
  const dialog = await openInviteAgent(page);
  await fillAda(page);
  await dialog.getByRole('button', { name: /^Add Ada/ }).click();
  await expect(
    dialog.getByRole('button', { name: /Adding Ada/ })
  ).toBeVisible();
  await expect(dialog).toBeVisible();

  await expect(dialog).toBeHidden({ timeout: 10_000 });
  const agentRow = page.locator('[data-member-kind="agent"]');
  await expect(agentRow.getByRole('status')).toHaveText('Setting up');
  await expect(agentRow.locator('[data-agent-setup-step]')).toHaveText(
    'Creating the computer'
  );
  await screenshot(page, testInfo, 'members-slow-path');
});

test('a declined card keeps the dialog, nothing behind, and Try again buys anew', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 0, {
    failedCreates: 1,
    refusal: 'payment_declined',
  });
  await page.goto('/');
  const dialog = await openInviteAgent(page);
  await fillAda(page);
  await dialog.getByRole('button', { name: /^Add Ada/ }).click();

  const notice = dialog.locator('[data-add-agent-state="declined"]');
  await expect(notice).toContainText('Nothing was charged');
  await expect(notice).toBeInViewport();
  await expect(
    dialog.getByRole('button', { name: 'Update card' })
  ).toBeVisible();
  await expect(page.locator('[data-member-kind="agent"]')).toHaveCount(0);
  await screenshot(page, testInfo, 'add-agent-declined');

  await dialog.getByRole('button', { name: /^Try again/ }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  const [declined, again] = backend.created as { purchaseKey: string }[];
  expect(again?.purchaseKey).not.toBe(declined?.purchaseKey);
});

test('a size with no room is marked and another size can be added', async ({
  page,
}, testInfo) => {
  await scriptAuthService(page, 0, { failedCreates: 1, refusal: 'no_room' });
  await page.goto('/');
  const dialog = await openInviteAgent(page);
  await fillAda(page);
  await dialog.getByRole('button', { name: /^Add Ada/ }).click();

  await expect(dialog).toContainText('No room for a Standard computer');
  await expect(dialog.getByRole('radio', { name: 'Standard' })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: 'Large' })).toBeChecked();
  await screenshot(page, testInfo, 'add-agent-no-room');
  await dialog.getByRole('button', { name: /^Add Ada/ }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
});

test('the inviter hears when the agent is ready: Message Ada, and Connect Claude plan, closable', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 0, {
    agents: [ada('running')],
    computerConnected: true,
  });
  await page
    .context()
    .route('https://claude.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' })
    );
  await page.goto('/');
  await expect(page.locator('[data-member-kind="agent"]')).toContainText('Ada');

  await notify(page, 'ready');
  await expect(page.getByText('Ada is ready')).toBeVisible();
  await expect(page.getByText('Message Ada to get started.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Message Ada' })).toBeVisible();
  await expect(
    page
      .getByLabel('Ada is ready')
      .getByRole('button', { name: 'Connect Claude plan' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try it' })).toHaveCount(0);
  await screenshot(page, testInfo, 'ready-notification-admin');

  // Connect Claude plan opens the sign-in on Ada's row, never blocking; the
  // agent stays on Macro credits when it closes.
  await page
    .getByLabel('Ada is ready')
    .getByRole('button', { name: 'Connect Claude plan' })
    .click();
  const signIn = page.getByRole('dialog');
  await expect(
    signIn.getByRole('heading', { name: 'Connect Ada to your Claude plan' })
  ).toBeVisible();
  await expect(
    signIn.getByRole('link', { name: 'Open claude.ai' })
  ).toHaveAttribute('href', /claude\.com/);
  await screenshot(page, testInfo, 'connect-claude-from-notification');
  expect(backend.claudeCalls).toContain('harness-ada claude-sign-in');
  await signIn
    .getByRole('button', { name: 'Keep using Macro credits' })
    .click();
  await expect(signIn).toBeHidden();
  expect(backend.claudeCalls).not.toContain('harness-ada claude-sign-out');

  // Message Ada opens the DM with the agent.
  await notify(page, 'ready');
  await page.getByRole('button', { name: 'Message Ada' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.teamAgentsFixture.opened.map((content) => content.type)
      )
    )
    .toContain('channel');
  expect(
    await page.evaluate(() =>
      window.teamAgentsFixture.opened.find(
        (content) => content.type === 'channel'
      )
    )
  ).toEqual({ type: 'channel', id: `dm-${ADA}` });
});

test("an admin signs the agent's computer in to Claude from its row", async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 0, {
    agents: [ada('running')],
    computerConnected: true,
  });
  await page
    .context()
    .route('https://claude.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' })
    );
  await page.goto('/');

  const agentRow = page.locator('[data-member-kind="agent"]');
  const claude = agentRow.locator('[data-agent-claude]');
  await expect(claude).toContainText('Claude: Macro credits');
  await claude.getByRole('button', { name: 'Connect Claude plan' }).click();
  const dialog = page.getByRole('dialog');
  const open = dialog.getByRole('link', { name: 'Open claude.ai' });
  await expect(open).toHaveAttribute(
    'href',
    'https://claude.com/cai/oauth/authorize?state=scripted'
  );

  const claudeTab = page.context().waitForEvent('page');
  await open.click();
  await (await claudeTab).close();
  await dialog
    .getByRole('textbox', { name: 'Paste the code Claude showed you' })
    .fill(' code-123 ');
  await dialog.getByRole('button', { name: 'Complete sign-in' }).click();
  await expect(dialog).toBeHidden();
  expect(backend.claudeCodes).toEqual(['code-123']);
  await expect(claude).toContainText('Claude: your plan');
  await screenshot(page, testInfo, 'row-signed-in');

  await claude.getByRole('button', { name: 'Switch to Macro credits' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Switch Ada to Macro credits?');
  await confirm
    .getByRole('button', { name: 'Switch to Macro credits' })
    .click();
  await expect(claude).toContainText('Claude: Macro credits');
  expect(backend.claudeCalls).toContain('harness-ada claude-sign-out');
});

/**
 * Answers the next sign-in call at `action` with `status` and `body` once,
 * then lets the scripted harness answer again.
 */
async function failClaudeOnce(
  page: Page,
  action: 'claude-sign-in' | 'claude-sign-in/complete',
  status: number,
  body: unknown
) {
  let failed = false;
  await page.route(`**/harnesses/harness-ada/${action}`, (route) => {
    if (failed) return route.fallback();
    failed = true;
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function openConnectClaude(page: Page) {
  await page
    .context()
    .route('https://claude.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' })
    );
  await page.goto('/');
  await page
    .locator('[data-agent-claude]')
    .getByRole('button', { name: 'Connect Claude plan' })
    .click();
  return page.getByRole('dialog');
}

async function pasteCode(page: Page, code: string) {
  const dialog = page.getByRole('dialog');
  const claudeTab = page.context().waitForEvent('page');
  await dialog
    .getByRole('link', { name: /Open claude\.ai|Open again/ })
    .click();
  await (await claudeTab).close();
  await dialog
    .getByRole('textbox', { name: 'Paste the code Claude showed you' })
    .fill(code);
  await dialog.getByRole('button', { name: 'Complete sign-in' }).click();
}

test('a sign-in that expired on the computer offers a new link, which signs in', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 0, {
    agents: [ada('running')],
    computerConnected: true,
  });
  // The computer's pending sign-in is gone (too old, or another tab's).
  await failClaudeOnce(page, 'claude-sign-in/complete', 410, {
    message: 'no Claude sign-in is waiting; start one first',
    code: 'sign_in_expired',
  });
  const dialog = await openConnectClaude(page);
  await pasteCode(page, 'stale#code');

  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText('This link expired');
  await expect(
    dialog.getByRole('textbox', { name: 'Paste the code Claude showed you' })
  ).toBeDisabled();
  await screenshot(page, testInfo, 'connect-claude-expired');

  await alert.getByRole('button', { name: 'Get a new link' }).click();
  await expect(alert).toBeHidden();
  await expect
    .poll(
      () =>
        backend.claudeCalls.filter(
          (call) => call === 'harness-ada claude-sign-in'
        ).length
    )
    .toBe(2);
  await pasteCode(page, 'fresh#code');
  await expect(dialog).toBeHidden();
  expect(backend.claudeCodes).toEqual(['fresh#code']);
  await expect(page.locator('[data-agent-claude]')).toContainText(
    'Claude: your plan'
  );
  await expect(page.getByText('Ada now uses your Claude plan')).toBeVisible();
});

test('a code Claude rejects asks for a new link; a malformed one keeps the field', async ({
  page,
}, testInfo) => {
  await scriptAuthService(page, 0, {
    agents: [ada('running')],
    computerConnected: true,
  });
  await failClaudeOnce(page, 'claude-sign-in/complete', 400, {
    message: 'paste the code Claude showed you',
    code: 'malformed_code',
  });
  const dialog = await openConnectClaude(page);
  await pasteCode(page, 'half-a-code');
  // Back from claude.ai, the tab title asks for the code.
  await expect(page).toHaveTitle(/Paste your Claude code/);
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText("doesn't look like the whole code");
  const field = dialog.getByRole('textbox', {
    name: 'Paste the code Claude showed you',
  });
  await expect(field).toBeEnabled();
  await expect(field).toHaveValue('half-a-code');
  await expect(alert.getByRole('button')).toHaveCount(0);

  await failClaudeOnce(page, 'claude-sign-in/complete', 422, {
    message: "That code didn't work — sign in again to get a new one",
    code: 'invalid_code',
  });
  await field.fill('wrong#code');
  await dialog.getByRole('button', { name: 'Complete sign-in' }).click();
  await expect(alert).toContainText("Claude didn't accept that code");
  await expect(
    alert.getByRole('button', { name: 'Get a new link' })
  ).toBeVisible();
  // That sign-in is over, so the tab no longer asks for its code.
  await expect(page).not.toHaveTitle(/Paste your Claude code/);
  await screenshot(page, testInfo, 'connect-claude-rejected');
});

test('a code that finishes after the dialog closed toasts, and leaves a reopened dialog open', async ({
  page,
}) => {
  const backend = await scriptAuthService(page, 0, {
    agents: [ada('running')],
    computerConnected: true,
  });
  // The computer answers the code only when the test says so.
  let answer: () => void = () => {};
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route(
    '**/harnesses/harness-ada/claude-sign-in/complete',
    async (route) => {
      await answered;
      return route.fallback();
    }
  );
  const dialog = await openConnectClaude(page);
  await pasteCode(page, 'slow#code');
  await expect(
    dialog.getByRole('button', { name: 'Complete sign-in' })
  ).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Opened again while the first code is still being checked.
  await page
    .locator('[data-agent-claude]')
    .getByRole('button', { name: 'Connect Claude plan' })
    .click();
  const reopened = page.getByRole('dialog');
  await expect(
    reopened.getByRole('heading', { name: 'Connect Ada to your Claude plan' })
  ).toBeVisible();

  answer();
  await expect(page.getByText('Ada now uses your Claude plan')).toBeVisible();
  expect(backend.claudeCodes).toEqual(['slow#code']);
  // The late answer belongs to the closed dialog; the reopened one stays.
  await expect(reopened).toBeVisible();
});

test('a runtime outside the rollout says so, and Try again starts the sign-in', async ({
  page,
}, testInfo) => {
  await scriptAuthService(page, 0, {
    agents: [ada('running')],
    computerConnected: true,
  });
  await failClaudeOnce(page, 'claude-sign-in', 403, {
    message: 'Macro computers are not enabled for this user',
    code: 'rollout_disabled',
  });
  const dialog = await openConnectClaude(page);
  const alert = dialog.getByRole('alert');
  await expect(alert).toHaveText(
    /Computers aren't available for this account yet\./
  );
  await screenshot(page, testInfo, 'connect-claude-rollout-disabled');
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(
    dialog.getByRole('link', { name: 'Open claude.ai' })
  ).toHaveAttribute('href', /claude\.com/);
});

test('a caller without rights to the computer is told so, with no way to retry', async ({
  page,
}, testInfo) => {
  await scriptAuthService(page, 0, {
    agents: [ada('running')],
    computerConnected: true,
  });
  await failClaudeOnce(page, 'claude-sign-in', 403, {
    message: 'you cannot do that on this computer',
  });
  const dialog = await openConnectClaude(page);
  const alert = dialog.getByRole('alert');
  await expect(alert).toHaveText(
    /You can't change this computer\. Ask a team owner or admin\./
  );
  await screenshot(page, testInfo, 'connect-claude-forbidden');
  await expect(alert.getByRole('button')).toHaveCount(0);
  await expect(
    dialog.getByRole('textbox', { name: 'Paste the code Claude showed you' })
  ).toBeDisabled();
});

test('an unreachable computer says so, and Try again starts the sign-in', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 0, {
    agents: [ada('running')],
    computerConnected: true,
  });
  await failClaudeOnce(page, 'claude-sign-in', 503, {
    message: 'the computer is not reachable; is it running?',
    code: 'computer_unreachable',
  });
  const dialog = await openConnectClaude(page);
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText("Can't reach the computer");
  await screenshot(page, testInfo, 'connect-claude-unreachable');
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(
    dialog.getByRole('link', { name: 'Open claude.ai' })
  ).toHaveAttribute('href', /claude\.com/);
  await expect(alert).toBeHidden();
  // The first, refused start never reached the scripted computer.
  expect(
    backend.claudeCalls.filter((call) => call === 'harness-ada claude-sign-in')
  ).toHaveLength(1);
});

test('a member hears the agent is ready, without Connect Claude plan', async ({
  page,
}, testInfo) => {
  await scriptAuthService(page, 0, {
    agents: [ada('running')],
    computerConnected: true,
    viewerOwnsRuntimes: false,
  });
  await page.goto(`/?viewer=${encodeURIComponent(MEMBER)}`);
  await expect(page.locator('[data-member-kind="agent"]')).toContainText('Ada');
  // Members invite people; only admins and owners add agents.
  await expect(
    page.getByRole('button', { name: 'Invite Human' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite Agent' })).toHaveCount(
    0
  );

  await notify(page, 'ready');
  await expect(page.getByText('Ada is ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Message Ada' })).toBeVisible();
  await expect(
    page
      .getByLabel('Ada is ready')
      .getByRole('button', { name: 'Connect Claude plan' })
  ).toHaveCount(0);
  await screenshot(page, testInfo, 'ready-notification-member');
});

test('a failed setup notifies with Retry, which sets the same computer up again', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 50, {
    agents: [ada('failed')],
  });
  await page.goto('/');
  const agentRow = page.locator('[data-member-kind="agent"]');
  await expect(agentRow.getByRole('status')).toHaveText('Needs attention');
  await expect(agentRow.getByRole('button', { name: 'Retry' })).toBeVisible();
  await screenshot(page, testInfo, 'members-failed-retry');

  await notify(page, 'failed');
  await expect(page.getByText("Ada couldn't be set up")).toBeVisible();
  await screenshot(page, testInfo, 'failed-notification');
  await page
    .locator('[data-macro-toast]')
    .getByRole('button', { name: 'Retry' })
    .click();
  await expect.poll(() => backend.retries).toEqual(['computer-ada']);
  await expect(agentRow.getByRole('status')).toHaveText('Setting up', {
    timeout: 15_000,
  });
  // Retrying never bought anything.
  expect(backend.created).toEqual([]);
});

test('a DM with an agent teammate that is not running says so', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 50, {
    agents: [ada('provisioning')],
  });
  await page.goto('/');
  await expect(page.locator('[data-member-kind="agent"]')).toContainText('Ada');
  await page.evaluate((userId) => window.teamAgentsFixture.openDm(userId), ADA);

  const dm = page.getByRole('region', { name: 'Direct message' });
  const banner = dm.locator('[data-agent-dm-status]');
  await expect(banner).toHaveText(
    "Ada is still being set up. It'll answer once it's ready."
  );
  await expect(dm.locator('[data-agent-dm-chip]')).toHaveText('Setting up');
  await screenshot(page, testInfo, 'dm-setting-up');

  const show = async (status: Agent['status'], connected: boolean) => {
    backend.agents = [ada(status)];
    backend.computerConnected = connected;
    await page.reload();
    await expect(page.locator('[data-member-kind="agent"]')).toContainText(
      'Ada'
    );
    await page.evaluate(
      (userId) => window.teamAgentsFixture.openDm(userId),
      ADA
    );
  };

  // The computer is up, but the agent hasn't come online yet.
  await show('starting', true);
  await expect(banner).toHaveText(
    "Ada is still being set up. It'll answer once it's ready."
  );
  await expect(dm.locator('[data-agent-dm-chip]')).toHaveText('Setting up');

  await show('failed', false);
  await expect(banner).toContainText("Ada isn't running: setup failed.");
  await expect(banner.getByRole('button', { name: 'Retry' })).toBeVisible();
  await screenshot(page, testInfo, 'dm-setup-failed');

  await show('running', false);
  await expect(banner).toHaveText(
    "Ada isn't running: its computer is offline."
  );
  await expect(dm.locator('[data-agent-dm-chip]')).toHaveText('Offline');
  await screenshot(page, testInfo, 'dm-offline');

  await show('released', false);
  await expect(banner).toHaveText("Ada isn't running right now.");
  await screenshot(page, testInfo, 'dm-not-running');

  // Running and connected: nothing to warn about.
  await show('running', true);
  await expect(dm).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(dm.locator('[data-agent-dm-chip]')).toHaveCount(0);
});

test('CRM access can be revoked and restored while privileged roles retain access', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page);
  await page.goto('/');
  const ownerRow = page.locator(`[data-team-member="${OWNER}"]`);
  await ownerRow.waitFor();
  await expect(ownerRow.getByRole('switch')).toHaveCount(0);
  await expect(
    ownerRow.getByText('Owners and admins always have access')
  ).toBeVisible();
  const control = page.getByRole('group', { name: /^CRM access for/ });
  const member = control.getByRole('switch', { name: /^CRM access for/ });
  await expect(member).toHaveCount(1);
  await expect(member).toBeChecked();
  await control.click();
  await expect(member).not.toBeChecked();
  expect(backend.crmSaves).toEqual([{ user_id: MEMBER, enabled: false }]);
  expect(backend.crmAccess[OWNER]).toBe(true);
  await screenshot(page, testInfo, 'crm-access-denied');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(testInfo.project.use.viewport!.width);
  await control.click();
  await expect(member).toBeChecked();
  expect(backend.crmSaves).toEqual([
    { user_id: MEMBER, enabled: false },
    { user_id: MEMBER, enabled: true },
  ]);
  await screenshot(page, testInfo, 'crm-access-restored');
});

for (const width of [360, 390]) {
  test(`CRM access controls fit the existing member row at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'Phone touch layout');
    await page.setViewportSize({ width, height: 844 });
    const backend = await scriptAuthService(page);
    await page.goto('/');
    const member = page.locator(`[data-team-member="${MEMBER}"]`);
    const toggle = member.getByRole('group', { name: /^CRM access for/ });
    await expect(toggle).toBeVisible();
    const bounds = await toggle.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await toggle.click();
    await expect(toggle.getByRole('switch')).not.toBeChecked();
    expect(backend.crmSaves).toEqual([{ user_id: MEMBER, enabled: false }]);
  });
}

test('CRM access controls are hidden from ordinary members', async ({
  page,
}, testInfo) => {
  await scriptAuthService(page);
  await page.goto(`/?viewer=${encodeURIComponent(MEMBER)}`);
  await expect(
    page.getByText('Members', { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: /^CRM access for/ }).getByRole('switch')
  ).toHaveCount(0);
  await screenshot(page, testInfo, 'crm-access-member-settings');
});

test('CRM access save failures keep the prior setting and allow retry', async ({
  page,
}) => {
  const backend = await scriptAuthService(page, 2, { failedCrmSaves: 1 });
  await page.goto('/');
  const member = page
    .getByRole('group', { name: /^CRM access for/ })
    .getByRole('switch');
  await expect(member).toBeChecked();
  await page.getByRole('group', { name: /^CRM access for/ }).click();
  await expect.poll(() => backend.crmSaves.length).toBe(1);
  await expect(member).toBeEnabled();
  await expect(member).toBeChecked();
  await page.getByRole('group', { name: /^CRM access for/ }).click();
  await expect(member).not.toBeChecked();
});

test('CRM access controls are absent while the server write flag is off', async ({
  page,
}) => {
  const backend = await scriptAuthService(page);
  await page.goto('/?crmAccessChanges=off');
  await expect(page.locator(`[data-team-member="${OWNER}"]`)).toBeVisible();
  await expect(
    page.getByRole('group', { name: /^CRM access for/ })
  ).toHaveCount(0);
  await expect(
    page.getByText('Owners and admins always have access')
  ).toHaveCount(0);
  expect(backend.crmSaves).toEqual([]);
});
