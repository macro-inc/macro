import { expect, type Page, test } from '@playwright/test';
import type {
  SlackAccount,
  SlackConversation,
  SlackLogin,
  SlackLoginStep,
  SlackLoginWorkspace,
} from '../../src/lib/service-clients/service-storage/generated/schemas';

const USER_ID = 'macro|slack-tester@example.test';

/** Server state the mocked DSS `/slack-linked` and `/external-chats` routes answer from. */
type SlackServer = {
  accounts: SlackAccount[];
  conversations: SlackConversation[];
  /** Each sign-in's steps still to come; the first is what it reads now. */
  logins: Record<string, SlackLoginStep[]>;
  /** What each step answer moves the attempt to, by step answered. */
  next: Partial<Record<string, SlackLoginStep[]>>;
  requests: string[];
  bodies: Record<string, unknown>;
};

const ACME_WORKSPACE: SlackLoginWorkspace = {
  teamId: 'T0ACME',
  name: 'Acme',
  domain: 'acme.slack.com',
  iconUrl: null,
  enterpriseName: null,
  signIn: 'ready',
  alreadyConnected: false,
};

const ACME: SlackAccount = {
  id: 'account-acme',
  teamId: 'T0ACME',
  teamName: 'Acme',
  teamDomain: 'acme.slack.com',
  teamIconUrl: null,
  enterpriseId: null,
  slackUserId: 'U0ME',
  displayName: 'Tester',
  state: 'connected',
  endedReason: null,
  authorizationGeneration: 2,
  lastConnectedAt: '2026-11-12T09:00:00Z',
};

const SHARED_LAUNCH: SlackConversation = {
  remoteId: 'C0SHARED',
  kind: 'group',
  name: '#shared-launch',
  topic: null,
  isPrivate: false,
  isArchived: false,
  frozen: false,
  connectedTeams: [
    { teamId: 'T0GLOBEX', name: 'Globex', domain: null, iconUrl: null },
  ],
  directPerson: null,
  accounts: ['account-acme'],
  lastActivityAt: '2026-11-12T08:00:00Z',
  unreadCount: 0,
  added: null,
  shared: null,
  canAdd: true,
  cannotAddReason: null,
};

function server(overrides: Partial<SlackServer> = {}): SlackServer {
  return {
    accounts: [],
    conversations: [],
    logins: {},
    next: {},
    requests: [],
    bodies: {},
    ...overrides,
  };
}

const EXPIRES_AT = '2030-01-01T00:00:00Z';

function loginBody(id: string, state: SlackServer): SlackLogin {
  const step = state.logins[id]?.[0] ?? { kind: 'cancelled' };
  // A `working` step resolves on the next read, as a replica would.
  if (step.kind === 'working' && (state.logins[id]?.length ?? 0) > 1)
    state.logins[id]?.shift();
  return { id, step, expiresAt: EXPIRES_AT };
}

/** Real client, queries and production adapter; the network is mocked here. */
async function mount(page: Page, state: SlackServer, query = '') {
  const origin = test.info().project.use.baseURL;
  const unexpected: string[] = [];
  page.on('pageerror', (error) => unexpected.push(error.message));
  await page.addInitScript(() => localStorage.setItem('macro:login', 'true'));
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/auth/user/legacy_user_permissions')
      return route.fulfill({
        json: {
          userId: USER_ID,
          email: 'slack-tester@example.test',
          permissions: [],
          tutorialComplete: true,
        },
      });
    if (/^\/dss\/(external-chats|slack-linked)(\/|$)/.test(url.pathname)) {
      const path = url.pathname.slice('/dss/'.length);
      const method = route.request().method();
      const key = `${method} ${path}`;
      state.requests.push(key);
      const body = route.request().postDataJSON();
      if (body !== null) state.bodies[key] = body;
      if (key === 'GET slack-linked/accounts')
        return route.fulfill({ json: { accounts: state.accounts } });
      if (key === 'GET slack-linked/conversations')
        return route.fulfill({
          json: { conversations: state.conversations, refreshing: false },
        });
      if (
        key === 'POST slack-linked/login' ||
        key === 'POST slack-linked/login/session'
      ) {
        const id = `login-${Object.keys(state.logins).length + 1}`;
        state.logins[id] = [{ kind: 'working' }, ...(state.next[path] ?? [])];
        return route.fulfill({ json: loginBody(id, state) });
      }
      const login = /^slack-linked\/login\/([^/]+)(?:\/([\w-]+))?$/.exec(path);
      if (login) {
        const [, id = '', step] = login;
        if (method === 'DELETE') state.logins[id] = [{ kind: 'cancelled' }];
        else if (method === 'POST' && step)
          state.logins[id] = state.next[step] ?? [];
        return route.fulfill({ json: loginBody(id, state) });
      }
      const disconnect = /^slack-linked\/accounts\/([^/]+)\/disconnect$/.exec(
        path
      );
      if (disconnect) {
        state.accounts = state.accounts.filter(
          (account) => account.id !== disconnect[1]
        );
        return route.fulfill({ json: { ...ACME, state: 'disconnected' } });
      }
      if (key === 'POST external-chats') {
        state.conversations = state.conversations.map((conversation) =>
          conversation.remoteId === body.remoteId
            ? { ...conversation, added: { id: 'chat-shared-launch' } }
            : conversation
        );
        return route.fulfill({ json: { chatId: 'chat-shared-launch' } });
      }
      if (key === 'GET external-chats') return route.fulfill({ json: [] });
      return route.fulfill({ status: 404, json: {} });
    }
    if (/^\/(auth|dss|notification|connection-gateway)\//.test(url.pathname))
      return route.fulfill({ json: {} });
    try {
      return await route.fulfill({ response: await route.fetch() });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Test ended'))
        return;
      throw error;
    }
  });
  await page.goto(`${origin}/tests/functional/slack-linked/index.html${query}`);
  return unexpected;
}

test('signs in by email code, picks a workspace, then adds a Slack Connect channel', async ({
  page,
}) => {
  const state = server({
    next: {
      'slack-linked/login': [
        {
          kind: 'email_code',
          email: 'slack-tester@example.test',
          retry: false,
        },
      ],
      code: [
        {
          kind: 'pick_workspaces',
          workspaces: [
            ACME_WORKSPACE,
            {
              ...ACME_WORKSPACE,
              teamId: 'T0INITECH',
              name: 'Initech',
              domain: 'initech.enterprise.slack.com',
              enterpriseName: 'Initech Holdings',
              signIn: 'sso',
            },
          ],
        },
      ],
      workspaces: [{ kind: 'working' }],
    },
  });
  const unexpected = await mount(page, state);

  await page.getByRole('button', { name: 'Sign in to Slack' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill('slack-tester@example.test');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText('Check your email')).toBeVisible();

  await dialog.getByLabel('Confirmation code').fill('abc-123');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText('Choose workspaces')).toBeVisible();
  await expect(
    dialog.getByText(/Part of Initech Holdings on Enterprise Grid/)
  ).toBeVisible();
  await expect(dialog.getByText(/SSO: finish in Macro desktop/)).toBeVisible();

  // The replica works through the pick, then reports the account.
  state.next.workspaces = [
    { kind: 'working' },
    {
      kind: 'done',
      accounts: [ACME],
      skipped: [{ ...ACME_WORKSPACE, teamId: 'T0INITECH', name: 'Initech' }],
    },
  ];
  state.accounts = [ACME];
  state.conversations = [SHARED_LAUNCH];
  await dialog.getByRole('button', { name: 'Connect 2 workspaces' }).click();
  await expect(dialog.getByText('Slack connected')).toBeVisible();
  await expect(dialog.getByText(/Still to finish with SSO/)).toBeVisible();
  expect(state.bodies['POST slack-linked/login/login-1/code']).toEqual({
    code: 'ABC-123',
  });
  expect(state.bodies['POST slack-linked/login/login-1/workspaces']).toEqual({
    teamIds: ['T0ACME', 'T0INITECH'],
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  const workspace = page.getByRole('region', { name: 'Acme' });
  const row = workspace.locator('[data-slack-conversation="C0SHARED"]');
  await expect(row.getByText('Globex')).toBeVisible();
  await row.hover();
  await row.getByRole('button', { name: 'Add to Macro' }).click();
  await expect(row.getByText('Added')).toBeVisible();
  expect(state.bodies['POST external-chats']).toEqual({
    provider: 'slack',
    remoteId: 'C0SHARED',
    kind: 'group',
  });
  expect(unexpected).toEqual([]);
});

test('Macro desktop signs in with Slack’s own page and posts the captured session', async ({
  page,
}) => {
  const state = server({
    next: {
      'slack-linked/login/session': [
        { kind: 'done', accounts: [ACME], skipped: [] },
      ],
    },
  });
  await mount(page, state, '?desktop=native');
  await page.getByRole('button', { name: 'Sign in to Slack' }).click();
  await page.getByRole('button', { name: 'Sign in with browser' }).click();
  await expect(page.getByText('Slack connected')).toBeVisible();
  expect(state.bodies['POST slack-linked/login/session']).toEqual({
    source: 'desktop',
    cookie: 'xoxd-desktop-cookie',
    cookieDs: '1700000000',
    tokens: [{ token: 'xoxc-desktop-token', teamId: 'T0INITECH' }],
  });
});

test('a browser hands Slack’s captcha to Macro desktop by attempt id', async ({
  page,
}) => {
  const state = server({
    logins: {
      'login-7': [
        {
          kind: 'captcha',
          siteKey: 'site-key',
          pageUrl: 'https://slack.com/signin',
          retry: false,
        },
      ],
    },
  });
  await mount(page, state, '?slackLogin=login-7');
  await expect(
    page.getByRole('link', { name: 'Continue on Macro desktop' })
  ).toHaveAttribute('href', 'macro:///external?slackLogin=login-7');
});

test('a pasted token and cookie sign in under Advanced', async ({ page }) => {
  const state = server({
    next: {
      'slack-linked/login/session': [
        { kind: 'failed', reason: 'invalid_session' },
      ],
    },
  });
  await mount(page, state);
  await page.getByRole('button', { name: 'Sign in to Slack' }).click();
  await page.getByText('Advanced').click();
  await page.getByRole('button', { name: 'Paste token and cookie' }).click();
  await page.getByLabel('Tokens (one per line)').fill('xoxc-1-2');
  await page.getByLabel('d cookie', { exact: true }).fill('d=xoxd-pasted');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(
    page.getByText(/Slack didn't accept that session/)
  ).toBeVisible();
  expect(state.bodies['POST slack-linked/login/session']).toEqual({
    source: 'manual',
    cookie: 'xoxd-pasted',
    tokens: [{ token: 'xoxc-1-2' }],
  });
});

test('a workspace whose session ended asks to sign in again; another disconnects', async ({
  page,
}) => {
  const state = server({
    accounts: [
      ACME,
      {
        ...ACME,
        id: 'account-globex',
        teamId: 'T0GLOBEX',
        teamName: 'Globex',
        state: 'logged_out',
        endedReason: 'revoked',
      },
    ],
    conversations: [SHARED_LAUNCH],
  });
  await mount(page, state);
  await expect(
    page.getByText(/Your Slack session for Globex ended/)
  ).toBeVisible();
  await page.getByRole('button', { name: 'Acme options' }).click();
  await page.getByRole('menuitem', { name: 'Disconnect' }).click();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('Disconnected Acme.')).toBeVisible();
  expect(
    state.bodies['POST slack-linked/accounts/account-acme/disconnect']
  ).toEqual({
    authorizationGeneration: 2,
    signOut: true,
  });
});
