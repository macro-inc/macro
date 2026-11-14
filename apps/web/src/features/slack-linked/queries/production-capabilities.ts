import { useUserId } from '@core/context/user';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName } from '@core/user/displayName';
import { isMacroId } from '@core/user/macroId';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import {
  refreshSlackAccounts,
  useAddSlackChatMutation,
  useDisconnectSlackMutation,
  useSlackAccountsQuery,
  useSlackConversationsQuery,
  useSlackLoginMutation,
  useSlackLoginQuery,
} from '@queries/slack-linked';
import { traceLoad } from '@queries/whatsapp-linked/operation';
import type { UseQueryResult } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type {
  DesktopSignIn,
  OpenSections,
  RequestFailure,
  SlackCatalogue,
  SlackLinkedCapabilities,
  SourceRead,
} from '../context/slack-linked-context';
import { accountsView, type SlackAccount } from '../core/account';
import {
  decodeAccount,
  decodeAddFailure,
  decodeConversation,
  decodeLogin,
  decodeLoginRequestFailure,
} from './decode';
import {
  canSignInOnDesktop,
  desktopSignInUrl,
  signInOnDesktop,
  solveCaptchaOnDesktop,
} from './desktop';

const failure = (): RequestFailure => ({ kind: 'request-failed' });

function sourceRead<Wire, Value>(
  query: UseQueryResult<Wire>,
  decode: (wire: Wire) => Value
): SourceRead<Value> {
  const data = createMemo(() =>
    queryReadyGate(query) ? decode(query.data) : undefined
  );
  return {
    get isPending() {
      return query.isPending;
    },
    get isError() {
      return query.isError;
    },
    get data() {
      return data();
    },
    refetch: () => fireAndForget(query.refetch(), 'slack-linked'),
  };
}

/**
 * Slack's own sign-in: in Macro desktop's window, handed off to Macro desktop
 * from a computer's browser, or not at all from a phone or tablet.
 */
function desktopSignIn(): DesktopSignIn {
  if (canSignInOnDesktop())
    return {
      kind: 'native',
      signIn: signInOnDesktop,
      captcha: solveCaptchaOnDesktop,
    };
  if (isNativeMobilePlatform() || isTouchDevice())
    return { kind: 'unsupported' };
  return { kind: 'handoff', desktopUrl: desktopSignInUrl };
}

/** The page has loaded once the accounts, and live ones' catalogue, have. */
function traceSlackPageLoad(
  accounts: SourceRead<SlackAccount[]>,
  catalogue: Accessor<SourceRead<SlackCatalogue> | undefined>
) {
  traceLoad('slack.page.load', () => {
    if (accounts.isError) return { outcome: 'error' };
    const list = accounts.data;
    if (!list) return;
    const { live, ended } = accountsView(list);
    const attrs = {
      'slack.accounts.live': live.length,
      'slack.accounts.ended': ended.length,
    };
    if (!live.length) return { outcome: 'success', attrs };
    const read = catalogue();
    if (read?.isError) return { outcome: 'error' };
    const conversations = read?.data?.conversations;
    if (!conversations) return;
    return {
      outcome: 'success',
      attrs: {
        ...attrs,
        'slack.conversations.count': conversations.length,
        'slack.conversations.in_macro': conversations.filter(
          (conversation) => conversation.inMacro
        ).length,
      },
    };
  });
}

/** The Slack page's capabilities, from the shared slack-linked queries. */
export function createSlackLinkedCapabilities(host: {
  openChat: (chatId: string) => void;
  sections: OpenSections;
}): SlackLinkedCapabilities {
  const user = useUserId();
  const currentUser = () => user() ?? '';
  const login = useSlackLoginMutation(currentUser);
  const disconnect = useDisconnectSlackMutation();
  const add = useAddSlackChatMutation();
  const accounts = sourceRead(useSlackAccountsQuery(currentUser), (list) =>
    list.accounts.map(decodeAccount)
  );
  const [catalogueRead, setCatalogueRead] =
    createSignal<SourceRead<SlackCatalogue>>();
  traceSlackPageLoad(accounts, catalogueRead);
  const submit = (input: Parameters<typeof login.mutateAsync>[0]) =>
    ResultAsync.fromPromise(
      login.mutateAsync(input),
      decodeLoginRequestFailure
    ).map(decodeLogin);
  return {
    accounts,
    catalogue: (enabled) => {
      const read = sourceRead(
        useSlackConversationsQuery(currentUser, enabled),
        (list): SlackCatalogue => ({
          refreshing: list.refreshing,
          conversations: list.conversations.map((conversation) =>
            decodeConversation(conversation, (ownerId) =>
              isMacroId(ownerId)
                ? getDisplayName(ownerId) || 'a teammate'
                : 'a teammate'
            )
          ),
        })
      );
      setCatalogueRead(() => read);
      return read;
    },
    login: (loginId) =>
      sourceRead(useSlackLoginQuery(currentUser, loginId), decodeLogin),
    startEmailLogin: (email) => submit({ step: 'email', email }),
    startSessionLogin: ({ source, session }) =>
      submit({
        step: 'session',
        session: {
          source,
          cookie: session.cookie,
          cookieDs: session.cookieDs,
          tokens: session.tokens.map((token) =>
            'teamId' in token && token.teamId
              ? { token: token.token, teamId: token.teamId }
              : { token: token.token }
          ),
        },
      }),
    answerLogin: (loginId, answer) => submit({ ...answer, loginId }),
    cancelLogin: (loginId) =>
      ResultAsync.fromPromise(
        login.mutateAsync({ step: 'cancel', loginId }),
        failure
      ).map(() => undefined),
    loginFinished: refreshSlackAccounts,
    get desktop() {
      return desktopSignIn();
    },
    disconnect: (account, { signOut }) =>
      ResultAsync.fromPromise(
        disconnect.mutateAsync({
          accountId: account.id,
          authorizationGeneration: account.generation,
          signOut,
        }),
        failure
      ).map(() => undefined),
    add: (conversation) =>
      ResultAsync.fromPromise(
        add.mutateAsync({
          remoteId: conversation.remoteId,
          kind: conversation.kind,
        }),
        decodeAddFailure
      ).map((added) => ({ chatId: added.chatId })),
    isDisconnecting: () => disconnect.isPending,
    openChat: host.openChat,
    sections: host.sections,
  };
}
