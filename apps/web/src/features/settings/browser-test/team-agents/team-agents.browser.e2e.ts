import { expect, type Page, type TestInfo, test } from '@playwright/test';

type Agent = {
  userId: string;
  teamId: string;
  name: string;
  jobDescription: string;
  personality: string;
  createdBy: string | null;
  computerId: string | null;
  status: 'provisioning' | 'running' | 'paused' | 'failed' | 'released';
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
    /** Invites the server refuses before one goes through. */
    failedCreates?: number;
    /** Whether macrod on an agent's computer has connected. */
    computerConnected?: boolean;
    /** Owners and admins own an agent computer's runtime; others don't see it. */
    viewerOwnsRuntimes?: boolean;
  } = {}
) {
  const backend = {
    agents: [...(options.agents ?? [])],
    created: [] as unknown[],
    removed: [] as string[],
    retries: [] as string[],
    reads: 0,
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
  };
  const viewerOwnsRuntimes = options.viewerOwnsRuntimes ?? true;
  const members = () => [
    { user_id: OWNER, role: 'owner', team_id: 'team-1', plan: 'premium' },
    { user_id: MEMBER, role: 'member', team_id: 'team-1', plan: 'premium' },
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
    poweredOn: agent.status === 'running',
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
      for (const agent of backend.agents) {
        if (
          agent.status === 'provisioning' &&
          backend.reads > provisioningReads
        )
          agent.status = 'running';
      }
      return json(200, { agents: backend.agents });
    }

    if (path.endsWith('/team_agents') && request.method() === 'POST') {
      const body = request.postDataJSON();
      backend.created.push(body);
      if (backend.failedCreates > 0) {
        backend.failedCreates -= 1;
        return json(409, { message: 'This size is sold out.' });
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
  await page.screenshot({ path: testInfo.outputPath(file), fullPage: true });
  if (screenshotDirectory)
    await page.screenshot({
      path: `${screenshotDirectory}/${file}`,
      fullPage: true,
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
  await expect(
    page.getByText('maya@example.com', { exact: false }).first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Agent', { exact: true }).click();
  return dialog;
}

async function fillAda(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Ada');
  await dialog
    .getByRole('textbox', { name: 'Job description' })
    .fill('Triage new support emails and draft replies for review.');
  await dialog
    .getByRole('textbox', { name: 'Personality' })
    .fill('Warm and concise. Asks before guessing.');
}

test('inviting an agent closes the dialog at once and its row shows the setup step', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 4);
  await page.goto('/');
  const dialog = await openInviteAgent(page);

  // Disabled, with the reason beside it.
  const invite = dialog.getByRole('button', { name: /^Invite agent/ });
  await expect(invite).toBeDisabled();
  await expect(dialog).toContainText(
    'Fill in the name, job description, and personality to invite.'
  );
  await screenshot(page, testInfo, 'invite-agent-empty');

  await fillAda(page);
  // Standard is preselected; XL is sold out. The price is the computer's.
  await expect(dialog.getByRole('radio', { name: 'Standard' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'XL' })).toBeDisabled();
  await dialog.getByText('Large', { exact: true }).click();
  await expect(invite).toHaveText('Invite agent · $80.00/month');

  // The personality suggests a voice; an explicit pick replaces it.
  const voice = dialog.getByRole('combobox', { name: 'Voice' });
  await expect(voice).toHaveValue('Thalia');
  await dialog.getByRole('button', { name: 'Show voices' }).click();
  await page.getByRole('option', { name: 'Arcas' }).click();
  await expect(voice).toHaveValue('Arcas');

  await invite.click();
  // No Bring your AI step: the dialog closes and says what happens next.
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("Ada is being set up. We'll let you know when it's ready.")
  ).toBeVisible();
  await screenshot(page, testInfo, 'invite-closes-with-notice');
  expect(backend.claudeCalls).toEqual([]);
  expect(backend.created).toEqual([
    {
      name: 'Ada',
      jobDescription: 'Triage new support emails and draft replies for review.',
      personality: 'Warm and concise. Asks before guessing.',
      size: 'large',
      avatarUrl: null,
      purchaseKey: expect.any(String),
      voice: 'aura-2-arcas-en',
    },
  ]);

  // One row for the agent: Setting up, with the step its computer is on.
  const agentRow = page.locator('[data-member-kind="agent"]');
  await expect(agentRow).toHaveCount(1);
  await expect(agentRow.getByRole('status')).toHaveText('Setting up');
  await expect(agentRow.locator('[data-agent-setup-step]')).toHaveText(
    'Creating the computer'
  );
  backend.step = 'booting';
  await expect(agentRow.locator('[data-agent-setup-step]')).toHaveText(
    'Starting up',
    { timeout: 15_000 }
  );
  await screenshot(page, testInfo, 'members-setting-up-step');

  // The list polls while the agent is provisioning.
  await expect(agentRow.getByRole('status')).toHaveText('Running', {
    timeout: 20_000,
  });
  await expect(agentRow.locator('[data-agent-setup-step]')).toHaveCount(0);

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

test('a refused invite brings its error into view and keeps its purchase key', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 0, { failedCreates: 1 });
  await page.goto('/');
  const dialog = await openInviteAgent(page);
  await fillAda(page);
  await dialog.getByRole('button', { name: /^Invite agent/ }).click();

  const error = dialog.locator('[data-invite-error]');
  await expect(error).toContainText("Couldn't buy a computer for this agent.");
  await expect(error).toBeInViewport();
  await expect(error).toBeFocused();
  await screenshot(page, testInfo, 'invite-error-in-view');

  await dialog.getByRole('button', { name: /^Invite agent/ }).click();
  await expect(dialog).toBeHidden();
  const [refused, retried] = backend.created as { purchaseKey: string }[];
  expect(retried?.purchaseKey).toBe(refused?.purchaseKey);
});

test('the inviter hears when the agent is ready: Message Ada, and Bring your AI with a Close', async ({
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
    page.getByRole('button', { name: 'Bring your AI' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try it' })).toHaveCount(0);
  await screenshot(page, testInfo, 'ready-notification-admin');

  // Bring your AI opens the sign-in on Ada's row, never blocking, with Close.
  await page.getByRole('button', { name: 'Bring your AI' }).click();
  const signIn = page.getByRole('dialog');
  await expect(
    signIn.getByRole('heading', { name: 'Bring your AI to Ada' })
  ).toBeVisible();
  await expect(
    signIn.getByRole('link', { name: 'Open claude.ai' })
  ).toBeVisible();
  await expect(
    signIn.getByRole('list', { name: 'Setup progress' })
  ).toBeVisible();
  await screenshot(page, testInfo, 'bring-your-ai-from-notification');
  expect(backend.claudeCalls).toContain('harness-ada claude-sign-in');
  await signIn.getByRole('button', { name: 'Close' }).click();
  await expect(signIn).toBeHidden();

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
  await claude.getByRole('button', { name: 'Sign in to Claude' }).click();
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

  await claude.getByRole('button', { name: 'Use Macro credits' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Switch Ada to Macro credits?');
  await confirm.getByRole('button', { name: 'Use Macro credits' }).click();
  await expect(claude).toContainText('Claude: Macro credits');
  expect(backend.claudeCalls).toContain('harness-ada claude-sign-out');
});

test('a member hears the agent is ready, without Bring your AI', async ({
  page,
}, testInfo) => {
  await scriptAuthService(page, 0, {
    agents: [ada('running')],
    computerConnected: true,
    viewerOwnsRuntimes: false,
  });
  await page.goto(`/?viewer=${encodeURIComponent(MEMBER)}`);
  await expect(page.locator('[data-member-kind="agent"]')).toContainText('Ada');

  await notify(page, 'ready');
  await expect(page.getByText('Ada is ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Message Ada' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bring your AI' })).toHaveCount(
    0
  );
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
