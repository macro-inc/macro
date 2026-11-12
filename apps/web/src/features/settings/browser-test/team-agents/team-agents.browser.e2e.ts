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
  options: { agents?: Agent[]; failedVoiceSaves?: number } = {}
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
  await expect(dialog).toBeHidden();
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
