import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from '@playwright/test';

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
const ADMIN = 'macro|lee@example.com';
const KAI = 'macro|kai@example.com';
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
    extraMembers?: {
      user_id: string;
      role: 'admin' | 'member';
      plan?: 'premium' | 'max';
    }[];
    /** Enterprise teams bill per seat, so every row has its seat plan menu. */
    enterprise?: boolean;
    /** Seat plans that change at renewal, by user id. */
    scheduledSeatPlans?: Record<string, 'premium' | 'max'>;
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
    roleUpdates: [] as { team_user_id: string; role: string }[],
    planMoves: [] as { userId: string; plan: string }[],
    removedMembers: [] as string[],
    /** While set, seat moves wait for it before the server answers. */
    planGate: undefined as Promise<void> | undefined,
  };
  const viewerOwnsRuntimes = options.viewerOwnsRuntimes ?? true;
  // Roles the owner changed take effect on the next read.
  const withRole = <T extends { user_id: string; role: string }>(member: T) => {
    const update = [...backend.roleUpdates]
      .reverse()
      .find((change) => change.team_user_id === member.user_id);
    return update ? { ...member, role: update.role } : member;
  };
  const members = () =>
    [
      { user_id: OWNER, role: 'owner', team_id: 'team-1', plan: 'premium' },
      { user_id: MEMBER, role: 'member', team_id: 'team-1', plan: 'premium' },
      ...(options.extraMembers ?? []).map((member) => ({
        team_id: 'team-1',
        plan: 'premium',
        ...member,
      })),
      // The server adds an agent's own account to the team.
      ...backend.agents.map((agent) => ({
        user_id: agent.userId,
        role: 'member',
        team_id: 'team-1',
        plan: 'premium',
      })),
    ].map(withRole);
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
      const roles = request.postDataJSON().user_role_updates;
      if (roles) {
        backend.roleUpdates.push(...roles);
        return json(200, null);
      }
    }

    const seat = path.match(/\/team\/members\/([^/]+)\/plan$/);
    if (seat) {
      const move = {
        userId: decodeURIComponent(seat[1] ?? ''),
        plan: request.postDataJSON().plan,
      };
      backend.planMoves.push(move);
      await backend.planGate;
      return json(200, { user_id: move.userId, plan: move.plan });
    }

    const removal = path.match(/\/team\/remove\/([^/]+)$/);
    if (removal && request.method() === 'DELETE') {
      backend.removedMembers.push(decodeURIComponent(removal[1] ?? ''));
      return json(200, {});
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
          enterprise: options.enterprise ?? false,
        },
        members: members(),
        scheduled_seat_plans: Object.fromEntries(
          Object.entries(options.scheduledSeatPlans ?? {}).map(
            ([userId, plan]) => [
              userId,
              { plan, effectiveAt: '2026-12-01T00:00:00Z' },
            ]
          )
        ),
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
  await dialog.getByRole('textbox', { name: 'Name it' }).fill('Ada');
}

test('adding an agent waits in the dialog until it is online, then closes into its DM', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 2);
  await page.goto('/');
  const dialog = await openInviteAgent(page);

  // Add is always pressable: with no name it marks the field and focuses it.
  const add = dialog.getByRole('button', { name: /^Add/ });
  const nameField = dialog.getByRole('textbox', {
    name: 'Name it',
  });
  // A new invite starts named Macronaught, the avatar its M.
  await expect(nameField).toHaveValue('Macronaught');
  await expect(dialog.locator('[data-slot="avatar"]')).toHaveText('M');
  await expect(add).toHaveText('Add Macronaught · $40.00/month');
  await screenshot(page, testInfo, 'add-agent-empty');
  // Cleared, it still needs a name.
  await nameField.fill('');
  await add.click();
  await expect(nameField).toHaveAttribute('aria-invalid', 'true');
  await expect(nameField).toBeFocused();
  await expect(dialog).toContainText('Give your agent a name to continue.');
  await screenshot(page, testInfo, 'add-agent-asked');
  expect(backend.created).toEqual([]);
  // The picture is the name's initial, redrawn as it is renamed.
  const picture = dialog.locator('[data-slot="avatar"]');
  // Cleared, it matches the example name the field shows.
  await expect(nameField).toHaveAttribute('placeholder', 'Macronaught');
  await expect(picture).toHaveText('M');
  await nameField.fill('Émile Zola');
  await expect(picture).toHaveText('É');
  await nameField.fill('小明');
  await expect(picture).toHaveText('小');
  await nameField.fill('Ada Lovelace');
  await expect(picture).toHaveText('A');
  await nameField.fill('Ada');
  await expect(picture).toHaveText('A');
  await expect(nameField).not.toHaveAttribute('aria-invalid', 'true');

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
  // Its picture is its initial, as in the form.
  await expect(agentRow.locator('[data-slot="avatar"]').first()).toHaveText(
    'A'
  );
  await expect(agentRow.locator('[data-agent-setup-step]')).toHaveCount(0);
  await screenshot(page, testInfo, 'members-online');

  // Its voice and removal are behind its ⋯, like a person's settings.
  const menu = await openRowMenu(page, testInfo, 'Ada');
  await expect(rowAction(menu, testInfo, 'Change voice')).toBeVisible();
  await screenshot(page, testInfo, 'agent-menu');

  // Removing deletes its computer and files, so it asks first; Cancel keeps it.
  await rowAction(menu, testInfo, 'Remove agent').click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'Remove Ada?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(
    "Its computer and files are deleted. This can't be undone."
  );
  await screenshot(page, testInfo, 'remove-agent-confirm');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(agentRow).toHaveCount(1);
  expect(backend.removed).toEqual([]);

  await rowAction(
    await openRowMenu(page, testInfo, 'Ada'),
    testInfo,
    'Remove agent'
  ).click();
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(agentRow).toHaveCount(0);
  expect(backend.removed).toEqual([ADA]);
});

test("an agent's row draws one letter however many words its name has", async ({
  page,
}) => {
  await scriptAuthService(page, 2, {
    agents: [{ ...ada('running'), name: 'Ada Lovelace' }],
  });
  await page.goto('/');
  const row = page.locator('[data-member-kind="agent"]');
  await expect(row).toContainText('Ada Lovelace');
  await expect(row.locator('[data-slot="avatar"]').first()).toHaveText('A');
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

test('each new invite starts from Macronaught, whatever the last one was renamed to', async ({
  page,
}) => {
  await scriptAuthService(page, 2);
  await page.goto('/');
  let dialog = await openInviteAgent(page);
  const nameField = () => dialog.getByRole('textbox', { name: 'Name it' });
  await expect(nameField()).toHaveValue('Macronaught');
  await nameField().fill('Émile Zola');
  await expect(dialog.locator('[data-slot="avatar"]')).toHaveText('É');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  dialog = await openInviteAgent(page);
  await expect(nameField()).toHaveValue('Macronaught');
  await expect(dialog.locator('[data-slot="avatar"]')).toHaveText('M');
});

test('Update card after a decline opens Billing, and the next invite keeps the name and size', async ({
  page,
}) => {
  await scriptAuthService(page, 0, {
    failedCreates: 1,
    refusal: 'payment_declined',
  });
  await page.goto('/');
  let dialog = await openInviteAgent(page);
  await fillAda(page);
  await dialog.getByText('Large', { exact: true }).click();
  await dialog.getByRole('button', { name: /^Add Ada/ }).click();
  await dialog.getByRole('button', { name: 'Update card' }).click();
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(() => JSON.stringify(window.teamAgentsFixture.opened))
  ).toContain('billing');

  // Back from Billing, the invite starts where it was left.
  dialog = await openInviteAgent(page);
  await expect(dialog.getByRole('textbox', { name: 'Name it' })).toHaveValue(
    'Ada'
  );
  await expect(dialog.getByRole('radio', { name: 'Large' })).toBeChecked();
  await expect(
    dialog.getByRole('button', { name: 'Add Ada · $80.00/month' })
  ).toBeVisible();

  // Cancel forgets it: a fresh invite starts from Macronaught again.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  dialog = await openInviteAgent(page);
  await expect(dialog.getByRole('textbox', { name: 'Name it' })).toHaveValue(
    'Macronaught'
  );
});

test('a long name shortens on Add while the price stays whole', async ({
  page,
}) => {
  await scriptAuthService(page, 2);
  await page.goto('/');
  const dialog = await openInviteAgent(page);
  const longName = 'Ada Augusta King, Countess of Lovelace and Analyst';
  await dialog.getByRole('textbox', { name: 'Name it' }).fill(longName);
  const add = dialog.getByRole('button', { name: /^Add Ada/ });
  await expect(add).toHaveAccessibleName(`Add ${longName} · $40.00/month`);
  const price = add.getByText('· $40.00/month');
  await expect(price).toBeVisible();
  const addBox = await add.boundingBox();
  const priceBox = await price.boundingBox();
  if (!addBox || !priceBox) throw new Error('Add or its price has no box');
  // The price sits inside the button, uncut, and the button inside the dialog.
  expect(priceBox.x).toBeGreaterThanOrEqual(addBox.x);
  expect(priceBox.x + priceBox.width).toBeLessThanOrEqual(
    addBox.x + addBox.width + 0.5
  );
  const dialogBox = await dialog.boundingBox();
  if (!dialogBox) throw new Error('The dialog has no box');
  expect(addBox.x + addBox.width).toBeLessThanOrEqual(
    dialogBox.x + dialogBox.width + 0.5
  );
  expect(
    await price.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  ).toBe(true);
  // Cancel stays beside Add, on the same row (measured together, once the
  // sheet has settled).
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  await expect
    .poll(async () => {
      const [a, c] = [await add.boundingBox(), await cancel.boundingBox()];
      if (!a || !c) return Number.POSITIVE_INFINITY;
      if (c.x + c.width > a.x) return Number.POSITIVE_INFINITY;
      return Math.abs(c.y + c.height / 2 - (a.y + a.height / 2));
    })
    .toBeLessThan(4);
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

const CRM_ACCESS = { name: /^CRM access for/ };

/** The phone project runs on touch, where a row's ⋯ opens a sheet, not a menu. */
function onTouch(testInfo: TestInfo) {
  return testInfo.project.name === 'phone';
}

/**
 * Opens the ⋯ of the row named `name`: the desktop menu, or the touch sheet,
 * which is titled with the name.
 */
async function openRowMenu(page: Page, testInfo: TestInfo, name: string) {
  const more = page.getByRole('button', { name: `Settings for ${name}` });
  // A real tap, as a phone sends it: it leaves focus in the sheet.
  if (onTouch(testInfo)) await more.tap();
  else await more.click();
  const menu = onTouch(testInfo)
    ? page.getByRole('dialog', { name, exact: true })
    : page.getByRole('menu');
  await expect(menu).toBeVisible();
  // A sheet still sliding in doesn't close on Escape yet.
  if (onTouch(testInfo)) {
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(menu).not.toHaveAttribute('data-transitioning');
  }
  return menu;
}

/** Closes the open menu or sheet with Escape. */
async function closeRowMenu(page: Page, menu: Locator) {
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

/** An action in an open row menu: a menu item, or a button in the sheet. */
function rowAction(menu: Locator, testInfo: TestInfo, name: string | RegExp) {
  return menu.getByRole(onTouch(testInfo) ? 'button' : 'menuitem', { name });
}

/** A plan or role choice in an open row menu. */
function rowChoice(menu: Locator, testInfo: TestInfo, name: RegExp) {
  return menu.getByRole(onTouch(testInfo) ? 'radio' : 'menuitemradio', {
    name,
  });
}

/** The CRM access control in an open row menu: a checkbox item, or a switch. */
function crmAccessIn(menu: Locator, testInfo: TestInfo) {
  return menu.getByRole(
    onTouch(testInfo) ? 'switch' : 'menuitemcheckbox',
    CRM_ACCESS
  );
}

/** Flips CRM access where a person taps it: the item, or the switch and its label. */
async function toggleCrmAccess(menu: Locator, testInfo: TestInfo) {
  if (!onTouch(testInfo)) return crmAccessIn(menu, testInfo).click();
  await menu
    .getByRole('group')
    .filter({ has: menu.page().getByRole('switch', CRM_ACCESS) })
    .tap();
}

function summaryOf(page: Page, id: string) {
  return page.locator(`[data-team-member="${id}"] [data-member-summary]`);
}

test('CRM access can be revoked and restored while privileged roles retain access', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page);
  await page.goto('/');
  await page.locator(`[data-team-member="${OWNER}"]`).waitFor();
  // The rows hold no CRM control, and one note under the list says why
  // owners and admins have no choice.
  await expect(page.getByRole('switch', CRM_ACCESS)).toHaveCount(0);
  await expect(
    page.getByText('Owners and admins always have CRM access.')
  ).toHaveCount(1);
  await expect(summaryOf(page, MEMBER)).toHaveText('Member');

  // The owner's access is on and can't be turned off, with the reason.
  const owner = await openRowMenu(page, testInfo, 'maya@example.com');
  await expect(crmAccessIn(owner, testInfo)).toBeChecked();
  await expect(crmAccessIn(owner, testInfo)).toBeDisabled();
  await expect(owner).toContainText(
    'Owners and admins always have CRM access.'
  );
  await closeRowMenu(page, owner);

  // A member's changes in place: the menu stays open on its new state.
  const member = await openRowMenu(page, testInfo, 'sam@example.com');
  await expect(crmAccessIn(member, testInfo)).toBeChecked();
  await toggleCrmAccess(member, testInfo);
  await expect(crmAccessIn(member, testInfo)).not.toBeChecked();
  expect(backend.crmSaves).toEqual([{ user_id: MEMBER, enabled: false }]);
  expect(backend.crmAccess[OWNER]).toBe(true);
  await screenshot(page, testInfo, 'crm-access-denied');
  await closeRowMenu(page, member);
  await expect(summaryOf(page, MEMBER)).toHaveText('Member · No CRM access');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(testInfo.project.use.viewport!.width);

  const again = await openRowMenu(page, testInfo, 'sam@example.com');
  await toggleCrmAccess(again, testInfo);
  await expect(crmAccessIn(again, testInfo)).toBeChecked();
  expect(backend.crmSaves).toEqual([
    { user_id: MEMBER, enabled: false },
    { user_id: MEMBER, enabled: true },
  ]);
  await closeRowMenu(page, again);
  await expect(summaryOf(page, MEMBER)).toHaveText('Member');
  await screenshot(page, testInfo, 'crm-access-restored');
});

/** Each person row's height, by user id. */
async function memberRowHeights(page: Page, ids: string[]) {
  const heights: Record<string, number> = {};
  for (const id of ids) {
    const box = await page.locator(`[data-team-member="${id}"]`).boundingBox();
    heights[id] = Math.round(box!.height);
  }
  return heights;
}

/**
 * How a person row lays out: whether its ⋯ ends the row inside the row's
 * padding, how big the ⋯ is, and whether the name shows in full.
 */
async function memberRowLayout(page: Page, id: string) {
  return page.locator(`[data-team-member="${id}"]`).evaluate((row) => {
    const box = row.getBoundingClientRect();
    const right =
      box.right - Number.parseFloat(getComputedStyle(row).paddingRight);
    const more = row.querySelector('[aria-label^="Settings for "]')!;
    const moreBox = more.getBoundingClientRect();
    const drawn = [...row.children].filter(
      (child) => child.getClientRects().length > 0
    );
    const name = row.querySelector<HTMLElement>('[data-member-name]')!;
    return {
      moreLast: drawn.at(-1)?.contains(more) ?? false,
      moreInside: moreBox.right <= right + 0.5,
      moreWidth: moreBox.width,
      moreHeight: moreBox.height,
      nameFits: name.scrollWidth <= name.clientWidth,
    };
  });
}

for (const seats of [true, false]) {
  test(`every person row has one shape, its settings behind ⋯, ${seats ? 'with' : 'without'} seat plans`, async ({
    page,
  }, testInfo) => {
    const touch = onTouch(testInfo);
    const { width: projectWidth, height } = testInfo.project.use.viewport!;
    // Phones, and on touch a tablet width.
    const widths = touch ? [projectWidth, 360, 320, 820] : [projectWidth];
    const rows = [OWNER, ADMIN, MEMBER];
    await scriptAuthService(page, 2, {
      enterprise: seats,
      extraMembers: [{ user_id: ADMIN, role: 'admin' }],
    });
    await page.goto('/');
    await page.locator(`[data-team-member="${MEMBER}"]`).waitFor();

    const plan = seats ? ' · Pro' : '';
    await expect(summaryOf(page, OWNER)).toHaveText(`Owner${plan}`);
    await expect(summaryOf(page, ADMIN)).toHaveText(`Admin${plan}`);
    await expect(summaryOf(page, MEMBER)).toHaveText(`Member${plan}`);
    const name = seats ? 'members' : 'members-no-seats';
    await screenshot(page, testInfo, name);

    for (const width of widths) {
      await page.setViewportSize({ width, height });
      // Owners, admins and members share one row: none is taller. On the
      // narrowest phone a name too long for its line wraps instead, as a
      // Machines row's name does.
      const heights = await memberRowHeights(page, rows);
      if (width >= 360) expect(new Set(Object.values(heights)).size).toBe(1);
      for (const id of rows) {
        const layout = await memberRowLayout(page, id);
        expect(layout.moreLast).toBe(true);
        expect(layout.moreInside).toBe(true);
        expect(layout.nameFits).toBe(true);
        if (touch) {
          expect(layout.moreWidth).toBeGreaterThanOrEqual(44);
          expect(layout.moreHeight).toBeGreaterThanOrEqual(44);
        }
      }
      if (width !== projectWidth)
        await screenshot(page, testInfo, `${name}-${width}`);
    }
  });
}

test("a member's ⋯ holds their plan, role, CRM access and Remove", async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 2, { enterprise: true });
  await page.goto('/');
  await page.locator(`[data-team-member="${MEMBER}"]`).waitFor();

  const menu = await openRowMenu(page, testInfo, 'sam@example.com');
  await expect(rowChoice(menu, testInfo, /^Pro/)).toBeChecked();
  await expect(rowChoice(menu, testInfo, /^Max/)).not.toBeChecked();
  await expect(rowChoice(menu, testInfo, /^Member/)).toBeChecked();
  await expect(rowChoice(menu, testInfo, /^Admin/)).not.toBeChecked();
  await expect(crmAccessIn(menu, testInfo)).toBeChecked();
  await expect(rowAction(menu, testInfo, 'Remove from team')).toBeEnabled();
  await screenshot(page, testInfo, 'member-menu');

  // Choosing a role or a plan makes the change and closes the menu; the row
  // then reads the new role, and its menu has it checked.
  await rowChoice(menu, testInfo, /^Admin/).click();
  await expect(menu).toBeHidden();
  await expect
    .poll(() => backend.roleUpdates)
    .toEqual([{ team_user_id: MEMBER, role: 'admin' }]);
  await expect(summaryOf(page, MEMBER)).toHaveText('Admin · Pro');
  const promoted = await openRowMenu(page, testInfo, 'sam@example.com');
  await expect(rowChoice(promoted, testInfo, /^Admin/)).toBeChecked();
  await closeRowMenu(page, promoted);

  // One seat move at a time: while it runs, every plan choice waits.
  let answerMove = () => {};
  backend.planGate = new Promise((resolve) => {
    answerMove = resolve;
  });
  const plans = await openRowMenu(page, testInfo, 'sam@example.com');
  await rowChoice(plans, testInfo, /^Max/).click();
  await expect(plans).toBeHidden();
  await expect
    .poll(() => backend.planMoves)
    .toEqual([{ userId: MEMBER, plan: 'max' }]);
  const moving = await openRowMenu(page, testInfo, 'sam@example.com');
  await expect(rowChoice(moving, testInfo, /^Pro/)).toBeDisabled();
  await expect(rowChoice(moving, testInfo, /^Max/)).toBeDisabled();
  await closeRowMenu(page, moving);
  answerMove();

  // Remove asks first; Cancel keeps them.
  const remove = await openRowMenu(page, testInfo, 'sam@example.com');
  await rowAction(remove, testInfo, 'Remove from team').click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'Remove Member' });
  await expect(confirm).toContainText('sam@example.com');
  await screenshot(page, testInfo, 'remove-member-confirm');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.locator(`[data-team-member="${MEMBER}"]`)).toBeVisible();
  expect(backend.removedMembers).toEqual([]);
});

test("settings the viewer can't change stay in place, disabled, with why", async ({
  page,
}, testInfo) => {
  await scriptAuthService(page, 2, {
    enterprise: true,
    extraMembers: [{ user_id: ADMIN, role: 'admin' }],
  });
  await page.goto('/');
  await page.locator(`[data-team-member="${OWNER}"]`).waitFor();

  // The owner's role and seat in the team are fixed; their plan is not.
  const owner = await openRowMenu(page, testInfo, 'maya@example.com');
  await expect(rowChoice(owner, testInfo, /^Pro/)).toBeEnabled();
  const role = owner.getByRole(onTouch(testInfo) ? 'radio' : 'menuitem', {
    name: /^Owner/,
  });
  await expect(role).toHaveAttribute('aria-disabled', 'true');
  await expect(role).toContainText("The team owner's role can't be changed");
  const remove = rowAction(owner, testInfo, /^Remove from team/);
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  await expect(remove).toContainText("The team owner can't be removed");
  await screenshot(page, testInfo, 'owner-menu');
  // A locked row reads why, and does nothing.
  await remove.click({ force: true });
  await expect(
    page.getByRole('dialog').filter({ hasText: 'Remove Member' })
  ).toHaveCount(0);
  await closeRowMenu(page, owner);
});

test('only the owner changes roles, and nobody removes themselves', async ({
  page,
}, testInfo) => {
  await scriptAuthService(page, 2, {
    enterprise: true,
    extraMembers: [{ user_id: ADMIN, role: 'admin' }],
  });
  await page.goto(`/?viewer=${encodeURIComponent(ADMIN)}`);
  await page.locator(`[data-team-member="${MEMBER}"]`).waitFor();
  const member = await openRowMenu(page, testInfo, 'sam@example.com');
  const memberRole = member.getByRole(
    onTouch(testInfo) ? 'radio' : 'menuitem',
    { name: /^Member/ }
  );
  await expect(memberRole).toHaveAttribute('aria-disabled', 'true');
  await expect(memberRole).toContainText(
    'Only the team owner can change roles'
  );
  await closeRowMenu(page, member);
  const self = await openRowMenu(page, testInfo, 'lee@example.com');
  await expect(rowAction(self, testInfo, /^Remove from team/)).toContainText(
    "You can't remove yourself"
  );
  await screenshot(page, testInfo, 'admin-own-menu');
});

test('a Max seat dropping to Pro says so, and Keep Max keeps it', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 2, {
    enterprise: true,
    // A Max seat that drops to Pro at renewal, with its CRM access off.
    extraMembers: [{ user_id: KAI, role: 'member', plan: 'max' }],
    scheduledSeatPlans: { [KAI]: 'premium' },
  });
  backend.crmAccess[KAI] = false;
  await page.goto('/');
  const summary = summaryOf(page, KAI);
  await expect(summary).toHaveText(
    'Member · Max · Pro at renewal · No CRM access'
  );
  if (onTouch(testInfo)) {
    // On the narrowest phone the line wraps, like a Machines row's meta line,
    // rather than cutting off what it says.
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await summary.evaluate((line) => line.scrollWidth <= line.clientWidth)
    ).toBe(true);
    await screenshot(page, testInfo, 'keep-max-320');
    await page.setViewportSize({ width: 390, height: 844 });
  }
  const menu = await openRowMenu(page, testInfo, 'kai@example.com');
  await rowAction(menu, testInfo, 'Keep Max').click();
  await expect
    .poll(() => backend.planMoves)
    .toEqual([{ userId: KAI, plan: 'max' }]);
});

test("ordinary members see everyone's role and plan, and no ⋯", async ({
  page,
}, testInfo) => {
  await scriptAuthService(page, 2, { enterprise: true });
  await page.goto(`/?viewer=${encodeURIComponent(MEMBER)}`);
  await expect(summaryOf(page, OWNER)).toHaveText('Owner · Pro');
  await expect(
    page.getByRole('button', { name: /^Settings for / })
  ).toHaveCount(0);
  await expect(page.getByText(/always have/)).toHaveCount(0);
  await screenshot(page, testInfo, 'crm-access-member-settings');
});

test('CRM access save failures keep the prior setting and allow retry', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 2, { failedCrmSaves: 1 });
  await page.goto('/');
  const menu = await openRowMenu(page, testInfo, 'sam@example.com');
  const access = crmAccessIn(menu, testInfo);
  await expect(access).toBeChecked();
  await toggleCrmAccess(menu, testInfo);
  await expect.poll(() => backend.crmSaves.length).toBe(1);
  await expect(access).toBeEnabled();
  await expect(access).toBeChecked();
  await toggleCrmAccess(menu, testInfo);
  await expect(access).not.toBeChecked();
});

test('CRM access controls are absent while the server write flag is off', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page);
  await page.goto('/?crmAccessChanges=off');
  await expect(page.locator(`[data-team-member="${OWNER}"]`)).toBeVisible();
  const menu = await openRowMenu(page, testInfo, 'sam@example.com');
  await expect(crmAccessIn(menu, testInfo)).toHaveCount(0);
  await expect(page.getByText(/always have/)).toHaveCount(0);
  expect(backend.crmSaves).toEqual([]);
});

/** A person's switch in CRM settings' Who can use CRM. */
function crmSettingsSwitch(page: Page, name: string) {
  return page.getByRole('switch', { name: `CRM access for ${name}` });
}

/** Flips a Who can use CRM switch where a person presses it: a click, or a tap. */
async function toggleCrmSettingsSwitch(
  page: Page,
  testInfo: TestInfo,
  name: string
) {
  const control = page
    .getByRole('group')
    .filter({ has: crmSettingsSwitch(page, name) });
  if (onTouch(testInfo)) await control.tap();
  else await control.click();
}

async function showPage(page: Page, name: 'members' | 'crm') {
  await page.evaluate(
    (shown) => window.teamAgentsFixture.showPage(shown),
    name
  );
}

test("CRM settings' Who can use CRM changes the same access as Members' ⋯", async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 2, {
    failedCrmSaves: 1,
    extraMembers: [{ user_id: ADMIN, role: 'admin' }],
    agents: [ada('running')],
  });
  await page.goto('/?crm');
  await expect(page.getByText('Who can use CRM')).toBeVisible();
  // The agent teammate is on the team but, as in Members, gets no switch.
  await expect(page.getByRole('switch')).toHaveCount(3);
  await expect(page.locator(`[data-team-member="${ADA}"]`)).toHaveCount(0);

  // Owners and admins stay on, with the reason on their row.
  for (const [id, name, summary] of [
    [OWNER, 'maya@example.com', 'Owner · Always has CRM access'],
    [ADMIN, 'lee@example.com', 'Admin · Always has CRM access'],
  ] as const) {
    await expect(crmSettingsSwitch(page, name)).toBeChecked();
    await expect(crmSettingsSwitch(page, name)).toBeDisabled();
    await expect(summaryOf(page, id)).toHaveText(summary);
  }

  // A failed save leaves the switch as it was, ready to try again.
  const sam = crmSettingsSwitch(page, 'sam@example.com');
  await expect(sam).toBeChecked();
  await toggleCrmSettingsSwitch(page, testInfo, 'sam@example.com');
  await expect.poll(() => backend.crmSaves.length).toBe(1);
  await expect(sam).toBeEnabled();
  await expect(sam).toBeChecked();
  await toggleCrmSettingsSwitch(page, testInfo, 'sam@example.com');
  await expect(sam).not.toBeChecked();
  expect(backend.crmSaves).toEqual([
    { user_id: MEMBER, enabled: false },
    { user_id: MEMBER, enabled: false },
  ]);
  expect(backend.crmAccess[MEMBER]).toBe(false);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(testInfo.project.use.viewport!.width);
  await screenshot(page, testInfo, 'crm-settings-access-off');

  // Members reads the same setting, and its ⋯ turns it back on.
  await showPage(page, 'members');
  await expect(summaryOf(page, MEMBER)).toHaveText('Member · No CRM access');
  const menu = await openRowMenu(page, testInfo, 'sam@example.com');
  await expect(crmAccessIn(menu, testInfo)).not.toBeChecked();
  await toggleCrmAccess(menu, testInfo);
  await expect(crmAccessIn(menu, testInfo)).toBeChecked();
  await closeRowMenu(page, menu);
  await showPage(page, 'crm');
  await expect(sam).toBeChecked();
  expect(backend.crmSaves.at(-1)).toEqual({ user_id: MEMBER, enabled: true });
});

test('admins also change CRM access in CRM settings', async ({
  page,
}, testInfo) => {
  const backend = await scriptAuthService(page, 2, {
    extraMembers: [{ user_id: ADMIN, role: 'admin' }],
  });
  await page.goto(`/?crm&viewer=${encodeURIComponent(ADMIN)}`);
  await toggleCrmSettingsSwitch(page, testInfo, 'sam@example.com');
  await expect(crmSettingsSwitch(page, 'sam@example.com')).not.toBeChecked();
  expect(backend.crmSaves).toEqual([{ user_id: MEMBER, enabled: false }]);
});

for (const [who, query] of [
  ['members', `viewer=${encodeURIComponent(MEMBER)}`],
  ['owners while the rollout is off', 'crmAccessChanges=off'],
] as const)
  test(`CRM settings lists no one's CRM access for ${who}`, async ({
    page,
  }, testInfo) => {
    await scriptAuthService(page);
    await page.goto(`/?crm&${query}`);
    // Members has the roster loaded, so CRM settings has had its answer too.
    await showPage(page, 'members');
    await expect(page.locator(`[data-team-member="${OWNER}"]`)).toBeVisible();
    await showPage(page, 'crm');
    await expect(page.getByText('Who can use CRM')).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
    await screenshot(
      page,
      testInfo,
      `crm-settings-hidden-${who.split(' ')[0]}`
    );
  });
