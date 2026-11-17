import { okAsync, type ResultAsync } from 'neverthrow';
import { type Accessor, createSignal, type Setter } from 'solid-js';
import { vi } from 'vitest';
import type {
  DesktopSignIn,
  LoginAnswer,
  RequestFailure,
  SlackCatalogue,
  SlackLinkedCapabilities,
  SourceRead,
} from '../context/slack-linked-context';
import type { SlackAccount } from '../core/account';
import type { AddFailure, SlackConversation } from '../core/conversation';
import type {
  LoginRead,
  LoginRequestFailure,
  SlackLoginStep,
} from '../core/login';

function signalRead<Value>(
  initial: Value | undefined
): [SourceRead<Value>, Setter<Value | undefined>] {
  const [data, setData] = createSignal<Value | undefined>(initial);
  return [
    {
      get isPending() {
        return data() === undefined;
      },
      isError: false,
      get data() {
        return data();
      },
      refetch: vi.fn(),
    },
    setData,
  ];
}

const EXPIRES_AT = '2030-01-01T00:00:00Z';

/** Server state a test drives by setting signals; actions are spies. */
export function createFakeSlack(initial: {
  accounts: SlackAccount[];
  catalogue?: SlackCatalogue;
  desktop?: DesktopSignIn;
  /** The step every sign-in request answers with, unless a test overrides it. */
  nextStep?: SlackLoginStep;
}) {
  const [accounts, setAccounts] = signalRead(initial.accounts);
  const [catalogue, setCatalogue] = signalRead(initial.catalogue);
  const [steps, setSteps] = createSignal<Record<string, SlackLoginStep>>({});
  let started = 0;
  let nextStep: SlackLoginStep = initial.nextStep ?? { kind: 'working' };
  /** Report `step` for a sign-in, the latest started one by default. */
  const setStep = (step: SlackLoginStep, loginId = `login-${started}`) =>
    setSteps((current) => ({ ...current, [loginId]: step }));
  /** What the next request answers with. */
  const answerWith = (step: SlackLoginStep) => {
    nextStep = step;
  };
  const respond = (loginId: string): LoginRead => {
    setStep(nextStep, loginId);
    return { loginId, step: nextStep, expiresAt: EXPIRES_AT };
  };
  const start = (): ResultAsync<LoginRead, LoginRequestFailure> =>
    okAsync(respond(`login-${++started}`));
  const loginRead = (loginId: Accessor<string>): SourceRead<LoginRead> => ({
    get isPending() {
      return steps()[loginId()] === undefined;
    },
    isError: false,
    get data() {
      const step = steps()[loginId()];
      return step
        ? { loginId: loginId(), step, expiresAt: EXPIRES_AT }
        : undefined;
    },
    refetch: vi.fn(),
  });
  const catalogueEnabled: Accessor<boolean>[] = [];
  const capabilities = {
    accounts,
    catalogue: vi.fn((enabled: Accessor<boolean>) => {
      catalogueEnabled.push(enabled);
      return catalogue;
    }),
    login: vi.fn(loginRead),
    startEmailLogin: vi.fn((_email: string) => start()),
    startSessionLogin: vi.fn(
      (_session: Parameters<SlackLinkedCapabilities['startSessionLogin']>[0]) =>
        start()
    ),
    answerLogin: vi.fn(
      (
        loginId: string,
        _answer: LoginAnswer
      ): ResultAsync<LoginRead, LoginRequestFailure> =>
        okAsync(respond(loginId))
    ),
    cancelLogin: vi.fn(
      (_loginId: string): ResultAsync<void, RequestFailure> =>
        okAsync(undefined)
    ),
    loginFinished: vi.fn(async () => undefined),
    desktop: initial.desktop ?? {
      kind: 'handoff',
      desktopUrl: (loginId: string | undefined) =>
        `macro:///external?slackLogin=${loginId ?? 'browser'}`,
    },
    disconnect: vi.fn(
      (
        _account: SlackAccount,
        _options: { signOut: boolean }
      ): ResultAsync<void, RequestFailure> => okAsync(undefined)
    ),
    add: vi.fn(
      (
        _conversation: Pick<SlackConversation, 'remoteId' | 'kind'>
      ): ResultAsync<{ chatId: string }, AddFailure> =>
        okAsync({ chatId: 'chat-new' })
    ),
    isDisconnecting: () => false,
    openChat: vi.fn(),
    sections: {
      isOpen: () => true,
      setOpen: vi.fn(),
    },
  } satisfies SlackLinkedCapabilities;
  return {
    capabilities,
    setAccounts,
    setCatalogue,
    setStep,
    answerWith,
    catalogueEnabled,
  };
}
