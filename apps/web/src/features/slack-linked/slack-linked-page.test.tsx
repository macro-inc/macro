import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlackLinkedProvider } from './context/slack-linked-context';
import type { SlackAccount } from './core/account';
import type { SlackConversation } from './core/conversation';
import type { SlackLoginWorkspace } from './core/login';
import type { SlackHandoff } from './primitives/slack-page';
import { SlackLinkedPage } from './slack-linked-page';
import { createFakeSlack } from './tests/fake-capabilities';

const device = vi.hoisted(() => ({ touch: false, phone: false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => device.phone }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({ toast }));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});

afterEach(() => {
  device.touch = false;
  device.phone = false;
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function mount(
  fake: ReturnType<typeof createFakeSlack>,
  handoff?: SlackHandoff
) {
  render(() => (
    <SlackLinkedProvider value={fake.capabilities}>
      <SlackLinkedPage handoff={handoff} />
    </SlackLinkedProvider>
  ));
}

const ACME: SlackAccount = {
  id: 'account-acme',
  teamId: 'T0ACME',
  teamName: 'Acme',
  teamDomain: 'acme.slack.com',
  teamIconUrl: undefined,
  enterprise: false,
  displayName: 'Maya',
  state: 'connected',
  endedReason: undefined,
  generation: 3,
};

const SHARED_LAUNCH: SlackConversation = {
  remoteId: 'C0SHARED',
  kind: 'group',
  name: '#shared-launch',
  isPrivate: false,
  isArchived: false,
  frozen: false,
  orgs: [{ teamId: 'T0GLOBEX', name: 'Globex' }],
  accountIds: ['account-acme'],
  lastActivityAt: '2026-11-10T10:00:00Z',
  inMacro: undefined,
  canAdd: true,
  cannotAddReason: undefined,
};

const WORKSPACE: SlackLoginWorkspace = {
  teamId: 'T0ACME',
  name: 'Acme',
  domain: 'acme.slack.com',
  iconUrl: null,
  enterpriseName: null,
  signIn: 'ready',
  alreadyConnected: false,
};

const typeInto = (label: string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });

describe('SlackPage sign-in', () => {
  it('signs in with email, code and a workspace pick', async () => {
    const fake = createFakeSlack({
      accounts: [],
      nextStep: { kind: 'email_code', email: 'maya@acme.test', retry: false },
    });
    mount(fake);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }));
    typeInto('Email', 'maya@acme.test');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(fake.capabilities.startEmailLogin).toHaveBeenCalledWith(
      'maya@acme.test'
    );
    await screen.findByText('Check your email');

    fake.answerWith({
      kind: 'pick_workspaces',
      workspaces: [
        WORKSPACE,
        {
          ...WORKSPACE,
          teamId: 'T0INITECH',
          name: 'Initech',
          domain: 'initech.enterprise.slack.com',
          enterpriseName: 'Initech Holdings',
          alreadyConnected: true,
        },
      ],
    });
    typeInto('Confirmation code', 'abc-123');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(fake.capabilities.answerLogin).toHaveBeenCalledWith('login-1', {
      step: 'code',
      code: 'ABC-123',
    });
    await screen.findByText('Choose workspaces');
    expect(
      screen.getByText(/Part of Initech Holdings on Enterprise Grid/)
    ).toBeTruthy();

    fake.answerWith({
      kind: 'done',
      accounts: [],
      skipped: [],
    });
    const connect = screen.getByRole('button', { name: 'Connect 1 workspace' });
    await waitFor(() => expect(connect.hasAttribute('disabled')).toBe(false));
    fireEvent.click(connect);
    expect(fake.capabilities.answerLogin).toHaveBeenLastCalledWith('login-1', {
      step: 'workspaces',
      teamIds: ['T0ACME'],
    });
    await screen.findByText('Slack connected');
    expect(fake.capabilities.loginFinished).toHaveBeenCalledOnce();
  });

  it('asks for a new code when Slack refuses one', async () => {
    const fake = createFakeSlack({
      accounts: [],
      nextStep: { kind: 'email_code', email: 'maya@acme.test', retry: true },
    });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }));
    typeInto('Email', 'maya@acme.test');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByText("That code didn't work. Check it and try again.")
    ).toBeTruthy();
  });

  it('hands a captcha off to Macro desktop from the browser', async () => {
    const fake = createFakeSlack({ accounts: [] });
    mount(fake, { kind: 'login', loginId: 'login-7' });
    fake.setStep(
      {
        kind: 'captcha',
        siteKey: 'site-key',
        pageUrl: 'https://slack.com/signin',
        retry: false,
      },
      'login-7'
    );
    const link = await screen.findByRole('link', {
      name: 'Continue on Macro desktop',
    });
    expect(link.getAttribute('href')).toBe(
      'macro:///external?slackLogin=login-7'
    );
  });

  it('solves a captcha in the desktop window and sends the solution', async () => {
    const captcha = vi.fn(() => okAsync('solution-token'));
    const fake = createFakeSlack({
      accounts: [],
      desktop: { kind: 'native', signIn: vi.fn(), captcha },
      nextStep: { kind: 'email_code', email: 'maya@acme.test', retry: false },
    });
    mount(fake, { kind: 'login', loginId: 'login-7' });
    fake.setStep(
      {
        kind: 'captcha',
        siteKey: 'site-key',
        pageUrl: 'https://slack.com/signin',
        retry: false,
      },
      'login-7'
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Verify on slack.com' })
    );
    await screen.findByText('Check your email');
    expect(captcha).toHaveBeenCalledWith(
      'site-key',
      'https://slack.com/signin'
    );
    expect(fake.capabilities.answerLogin).toHaveBeenCalledWith('login-7', {
      step: 'captcha',
      solution: 'solution-token',
    });
  });

  it('signs in with the desktop browser window and posts the captured session', async () => {
    const signIn = vi.fn(() =>
      okAsync({
        cookie: 'xoxd-cookie',
        cookieDs: undefined,
        tokens: [{ token: 'xoxc-token', teamId: 'T0ACME' }],
      })
    );
    const fake = createFakeSlack({
      accounts: [],
      desktop: { kind: 'native', signIn, captcha: vi.fn() },
      nextStep: { kind: 'done', accounts: [], skipped: [] },
    });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in with browser' })
    );
    await screen.findByText('Slack connected');
    expect(signIn).toHaveBeenCalledWith(undefined);
    expect(fake.capabilities.startSessionLogin).toHaveBeenCalledWith({
      source: 'desktop',
      session: {
        cookie: 'xoxd-cookie',
        cookieDs: undefined,
        tokens: [{ token: 'xoxc-token', teamId: 'T0ACME' }],
      },
    });
  });

  it('finishes an SSO workspace from the desktop window', async () => {
    const signIn = vi.fn(() =>
      okAsync({ cookie: 'xoxd-c', cookieDs: undefined, tokens: [] })
    );
    const fake = createFakeSlack({
      accounts: [],
      desktop: { kind: 'native', signIn, captcha: vi.fn() },
      nextStep: { kind: 'done', accounts: [], skipped: [] },
    });
    mount(fake, { kind: 'login', loginId: 'login-9' });
    fake.setStep(
      {
        kind: 'finish_on_desktop',
        team: { ...WORKSPACE, signIn: 'sso' },
        signInUrl: 'https://acme.slack.com/sso/saml/start',
      },
      'login-9'
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Sign in with browser' })
    );
    await screen.findByText('Slack connected');
    expect(signIn).toHaveBeenCalledWith(
      'https://acme.slack.com/sso/saml/start'
    );
  });

  it('checks a pasted token and cookie before sending them', async () => {
    const fake = createFakeSlack({
      accounts: [],
      nextStep: { kind: 'failed', reason: 'invalid_session' },
    });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Paste token and cookie' })
    );
    typeInto('Tokens (one per line)', 'xoxc-1-2');
    typeInto('d cookie', 'not-a-cookie');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(
      await screen.findByText("The d cookie's value starts with xoxd-.")
    ).toBeTruthy();
    expect(fake.capabilities.startSessionLogin).not.toHaveBeenCalled();

    typeInto('d cookie', 'd=xoxd-good');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(
      await screen.findByText(/Slack didn't accept that session/)
    ).toBeTruthy();
    expect(fake.capabilities.startSessionLogin).toHaveBeenCalledWith({
      source: 'manual',
      session: {
        cookie: 'xoxd-good',
        cookieDs: undefined,
        tokens: [{ token: 'xoxc-1-2' }],
      },
    });
  });

  it('says when sign-in requests are rate limited', async () => {
    const fake = createFakeSlack({ accounts: [] });
    fake.capabilities.startEmailLogin.mockReturnValue(
      errAsync({ kind: 'login-request-failed', reason: 'rate-limited' })
    );
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }));
    typeInto('Email', 'maya@acme.test');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByText(
        'Too many tries at once. Wait a minute, then try again.'
      )
    ).toBeTruthy();
  });

  it('cancels an open attempt when the dialog closes', async () => {
    const fake = createFakeSlack({
      accounts: [],
      nextStep: { kind: 'email_code', email: 'maya@acme.test', retry: false },
    });
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }));
    typeInto('Email', 'maya@acme.test');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Check your email');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(fake.capabilities.cancelLogin).toHaveBeenCalledWith('login-1')
    );
  });
});

describe('SlackPage catalogue', () => {
  it('lists Slack Connect conversations under their workspace and adds one', async () => {
    const fake = createFakeSlack({
      accounts: [ACME],
      catalogue: {
        refreshing: false,
        conversations: [
          SHARED_LAUNCH,
          {
            ...SHARED_LAUNCH,
            remoteId: 'C0ADDED',
            name: '#macro-acme',
            inMacro: { kind: 'own', chatId: 'chat-added' },
            canAdd: false,
          },
          {
            ...SHARED_LAUNCH,
            remoteId: 'D0DANA',
            kind: 'direct',
            name: 'Dana Kim',
          },
        ],
      },
    });
    mount(fake);
    const workspace = screen.getByRole('region', { name: 'Acme' });
    const channels = within(workspace).getByRole('list', {
      name: 'Slack Connect channels',
    });
    expect(within(channels).getAllByText('Globex')).toHaveLength(2);
    expect(within(channels).getByText('Added')).toBeTruthy();
    expect(
      within(workspace).getByRole('list', { name: 'Direct messages' })
    ).toBeTruthy();

    fireEvent.click(
      within(channels).getByRole('button', { name: 'Open #macro-acme' })
    );
    expect(fake.capabilities.openChat).toHaveBeenCalledWith('chat-added');

    fireEvent.click(
      within(channels).getAllByRole('button', { name: 'Add to Macro' })[0]!
    );
    await waitFor(() =>
      expect(fake.capabilities.add).toHaveBeenCalledWith(SHARED_LAUNCH)
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('shows details on desktop and keeps touch rows to the name', () => {
    const catalogue = { refreshing: false, conversations: [SHARED_LAUNCH] };
    mount(createFakeSlack({ accounts: [ACME], catalogue }));
    expect(screen.getByText('acme.slack.com')).toBeTruthy();
    expect(document.querySelector('time')).toBeTruthy();
    expect(screen.getByText('Add workspace')).toBeTruthy();
    cleanup();

    device.touch = true;
    mount(createFakeSlack({ accounts: [ACME], catalogue }));
    expect(screen.queryByText('acme.slack.com')).toBeNull();
    expect(document.querySelector('time')).toBeNull();
    expect(screen.getByText('Add to Macro')).toBeTruthy();
    expect(screen.getByText('Add workspace')).toBeTruthy();
    cleanup();

    device.phone = true;
    mount(createFakeSlack({ accounts: [ACME], catalogue }));
    expect(screen.queryByText('Add to Macro')).toBeNull();
    expect(screen.queryByText('Add workspace')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add to Macro' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add workspace' })).toBeTruthy();
  });

  it('words a refused add on its row', async () => {
    const fake = createFakeSlack({
      accounts: [ACME],
      catalogue: { refreshing: false, conversations: [SHARED_LAUNCH] },
    });
    fake.capabilities.add.mockReturnValue(
      errAsync({ kind: 'add-failed', reason: 'cannot-add', why: 'frozen' })
    );
    mount(fake);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Macro' }));
    expect(
      await screen.findByText('Disconnected from the other organization.')
    ).toBeTruthy();
  });

  it('shows a workspace whose session ended with Sign in again', () => {
    const fake = createFakeSlack({
      accounts: [
        { ...ACME, state: 'logged_out', endedReason: 'enterprise_restricted' },
      ],
    });
    mount(fake);
    expect(
      screen.getByText(/Your Slack admin blocks this kind of session/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(fake.catalogueEnabled[0]?.()).toBe(false);
  });

  it('disconnects a workspace, keeping its session when asked', async () => {
    const fake = createFakeSlack({
      accounts: [ACME],
      catalogue: { refreshing: false, conversations: [] },
    });
    mount(fake);
    expect(screen.getByText(/No Slack Connect conversations/)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Acme options' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(
      await screen.findByRole('menuitem', { name: 'Disconnect' }),
      { key: 'Enter' }
    );
    fireEvent.click(
      await screen.findByText('Also sign this session out of Slack')
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Disconnect',
      })
    );
    await waitFor(() =>
      expect(fake.capabilities.disconnect).toHaveBeenCalledWith(ACME, {
        signOut: false,
      })
    );
  });
});
