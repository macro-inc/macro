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

const OWNER = 'macro|maya@example.com';

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

/**
 * The services the page talks to: the roster, the computer catalog,
 * `/team_agents` with its voices, and the agent harness's voice catalog.
 * A new agent reports `provisioning` until the list has been read
 * `provisioningReads` more times, then `running`.
 */
async function scriptAuthService(
  page: Page,
  provisioningReads = 2,
  options: {
    agents?: Agent[];
    failedVoiceSaves?: number;
    /** Whether macrod on a new agent's computer has connected. */
    computerConnected?: boolean;
  } = {}
) {
  const backend = {
    agents: [...(options.agents ?? [])],
    created: [] as unknown[],
    removed: [] as string[],
    reads: 0,
    voices: {} as Record<string, string>,
    voiceSaves: [] as unknown[],
    failedVoiceSaves: options.failedVoiceSaves ?? 0,
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
  const members = () => [
    { user_id: OWNER, role: 'owner', team_id: 'team-1', plan: 'premium' },
    {
      user_id: 'macro|sam@example.com',
      role: 'member',
      team_id: 'team-1',
      plan: 'premium',
    },
    // The server adds an agent's own account to the team.
    ...backend.agents.map((agent) => ({
      user_id: agent.userId,
      role: 'member',
      team_id: 'team-1',
      plan: 'premium',
    })),
  ];

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
        // The purchase confirms after the invite answers.
        agent.computerId ??= `computer-${agent.name.toLowerCase()}`;
      }
      return json(200, { agents: backend.agents });
    }

    if (path.endsWith('/team_agents') && request.method() === 'POST') {
      const body = request.postDataJSON();
      backend.created.push(body);
      backend.reads = 0;
      const agent: Agent = {
        userId: `macro|${body.name.toLowerCase()}@agents.macro.invalid`,
        teamId: 'team-1',
        name: body.name,
        jobDescription: body.jobDescription,
        personality: body.personality,
        createdBy: OWNER,
        computerId: null,
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
        backend.agents.map((agent) => ({
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
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-${name}.png`),
    fullPage: true,
  });
}

test('an admin invites an agent teammate and sees it come up', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page);
  await page.goto('/');

  const roster = page.getByText('maya@example.com', { exact: false });
  await expect(roster.first()).toBeVisible();

  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Agent', { exact: true }).click();

  const invite = dialog.getByRole('button', { name: /^Invite agent/ });
  await expect(invite).toBeDisabled();
  await screenshot(page, testInfo, 'invite-agent-empty');

  await dialog.getByRole('textbox', { name: 'Name' }).fill('Ada');
  await dialog
    .getByRole('textbox', { name: 'Job description' })
    .fill('Triage new support emails and draft replies for review.');
  await dialog
    .getByRole('textbox', { name: 'Personality' })
    .fill('Warm and concise. Asks before guessing.');

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
  await screenshot(page, testInfo, 'invite-agent');

  await invite.click();
  // Bring your AI waits for the new computer; the admin keeps credits.
  await expect(
    dialog.getByRole('heading', { name: 'Bring your AI to Ada' })
  ).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('Preparing sign-in');
  await screenshot(page, testInfo, 'bring-your-ai-waiting');
  // Its row shows its Claude, with nothing to sign in on until it connects.
  const claudeLine = page.locator('[data-agent-claude]');
  await expect(claudeLine).toContainText('Claude: Macro credits');
  await expect(claudeLine.getByRole('button')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Skip, use Macro credits' }).click();
  await expect(dialog).toBeHidden();
  // Nothing started a sign-in, and a computer on credits has no login to read.
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

  // One row for the agent, with its status, not a second person row.
  const agentRow = page.locator('[data-member-kind="agent"]');
  await expect(agentRow).toHaveCount(1);
  await expect(agentRow).toContainText('Ada');
  await expect(agentRow.getByRole('status')).toHaveText('Setting up');
  await screenshot(page, testInfo, 'members-provisioning');

  // The list polls while the agent is provisioning.
  await expect(agentRow.getByRole('status')).toHaveText('Running', {
    timeout: 15_000,
  });
  await screenshot(page, testInfo, 'members-running');

  await agentRow.getByRole('button', { name: 'Remove agent' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Remove Ada from the team?');
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(agentRow).toHaveCount(0);
  expect(backend.removed).toEqual(['macro|ada@agents.macro.invalid']);
});

test("an admin signs the new agent's computer in to the team's Claude plan", async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 0, {
    computerConnected: true,
  });
  await page
    .context()
    .route('https://claude.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' })
    );
  await page.goto('/');
  await expect(
    page.getByText('maya@example.com', { exact: false }).first()
  ).toBeVisible();

  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Agent', { exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Ada');
  await dialog
    .getByRole('textbox', { name: 'Job description' })
    .fill('Triage new support emails and draft replies for review.');
  await dialog
    .getByRole('textbox', { name: 'Personality' })
    .fill('Warm and concise. Asks before guessing.');
  await dialog.getByRole('button', { name: /^Invite agent/ }).click();

  // Once the purchase confirms and macrod connects, the sign-in opens.
  const open = dialog.getByRole('link', { name: 'Open claude.ai' });
  await expect(open).toBeVisible({ timeout: 15_000 });
  await expect(open).toHaveAttribute(
    'href',
    'https://claude.com/cai/oauth/authorize?state=scripted'
  );
  await expect(
    dialog.getByRole('button', { name: 'Use Macro credits instead' })
  ).toBeVisible();
  await screenshot(page, testInfo, 'bring-your-ai-open');

  const claudeTab = page.context().waitForEvent('page');
  await open.click();
  await (await claudeTab).close();
  await dialog
    .getByRole('textbox', { name: 'Paste the code Claude showed you' })
    .fill(' code-123 ');
  await screenshot(page, testInfo, 'bring-your-ai-code');
  await dialog.getByRole('button', { name: 'Complete sign-in' }).click();
  await expect(dialog).toBeHidden();
  expect(backend.claudeCodes).toEqual(['code-123']);
  expect(backend.claudeCalls).toContain('harness-ada claude-sign-in');

  // The row shows the plan and offers the way back to credits.
  const agentRow = page.locator('[data-member-kind="agent"]');
  const claude = agentRow.locator('[data-agent-claude]');
  await expect(claude).toContainText('Claude: your plan');
  await screenshot(page, testInfo, 'row-signed-in');

  await claude.getByRole('button', { name: 'Use Macro credits' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Switch Ada to Macro credits?');
  await confirm.getByRole('button', { name: 'Use Macro credits' }).click();
  await expect(claude).toContainText('Claude: Macro credits');
  expect(backend.claudeCalls).toContain('harness-ada claude-sign-out');
  await screenshot(page, testInfo, 'row-credits');

  // Signing in later starts from the row.
  await claude.getByRole('button', { name: 'Sign in to Claude' }).click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Open claude.ai' })
  ).toBeVisible();
  await screenshot(page, testInfo, 'row-sign-in');
});
