import type { ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type {
  OpenSections,
  RequestFailure,
  SourceRead,
} from '../../whatsapp-linked/context/whatsapp-linked-context';
import type { SlackAccount } from '../core/account';
import type { AddFailure, SlackConversation } from '../core/conversation';
import type {
  LoginRead,
  LoginRequestFailure,
  PastedSession,
} from '../core/login';

export type { OpenSections, RequestFailure, SourceRead };

/** The catalogue as the page shows it. */
export type SlackCatalogue = {
  conversations: SlackConversation[];
  /** Slack is being asked for changes; the list may grow. */
  refreshing: boolean;
};

/** A session Macro desktop read from its Slack window. */
export type CapturedSession = {
  cookie: string;
  cookieDs: string | undefined;
  tokens: { token: string; teamId: string | undefined }[];
};

/** Why the desktop Slack window didn't hand back what it was opened for. */
export type DesktopFailure =
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

/**
 * Signing in on slack.com itself (SSO, Slack's captcha). Only Macro desktop
 * can: it opens Slack in a separate window and reads the session. A browser
 * hands the sign-in off to it; a phone can't.
 */
export type DesktopSignIn =
  | {
      kind: 'native';
      /** Slack's sign-in, at `signInUrl` (a workspace's SSO) or its start page. */
      signIn: (
        signInUrl: string | undefined
      ) => ResultAsync<CapturedSession, DesktopFailure>;
      /** Slack's captcha on slack.com; resolves with its solution. */
      captcha: (
        siteKey: string,
        pageUrl: string
      ) => ResultAsync<string, DesktopFailure>;
    }
  | {
      kind: 'handoff';
      /** Opens Macro desktop at this sign-in (by id), or a new browser sign-in. */
      desktopUrl: (loginId: string | undefined) => string;
    }
  | { kind: 'unsupported' };

/** An answer to the step a sign-in waits on. */
export type LoginAnswer =
  | { step: 'captcha'; solution: string }
  | { step: 'code'; code: string }
  | { step: 'workspaces'; teamIds: string[] }
  | { step: 'two_factor'; code: string };

/**
 * Everything the Slack page reads and does. Production builds it from the
 * shared `slack-linked` queries; tests pass fakes.
 */
export type SlackLinkedCapabilities = {
  /** Every workspace the person signed in to, in any state. */
  accounts: SourceRead<SlackAccount[]>;
  /** The Slack Connect catalogue; read only while `enabled`. */
  catalogue: (enabled: Accessor<boolean>) => SourceRead<SlackCatalogue>;
  /** One sign-in attempt, re-read while a replica works on it. */
  login: (loginId: Accessor<string>) => SourceRead<LoginRead>;
  startEmailLogin: (
    email: string
  ) => ResultAsync<LoginRead, LoginRequestFailure>;
  startSessionLogin: (
    session:
      | { source: 'manual'; session: PastedSession }
      | { source: 'desktop'; session: CapturedSession }
  ) => ResultAsync<LoginRead, LoginRequestFailure>;
  answerLogin: (
    loginId: string,
    answer: LoginAnswer
  ) => ResultAsync<LoginRead, LoginRequestFailure>;
  cancelLogin: (loginId: string) => ResultAsync<void, RequestFailure>;
  /** A sign-in finished: refresh the accounts and the catalogue. */
  loginFinished: () => Promise<unknown>;
  desktop: DesktopSignIn;
  disconnect: (
    account: SlackAccount,
    options: { signOut: boolean }
  ) => ResultAsync<void, RequestFailure>;
  /** One click: the Macro chat takes the Slack conversation's name. */
  add: (
    conversation: Pick<SlackConversation, 'remoteId' | 'kind'>
  ) => ResultAsync<{ chatId: string }, AddFailure>;
  isDisconnecting: Accessor<boolean>;
  /** Host action: open a chat in Macro. */
  openChat: (chatId: string) => void;
  /** The catalogue's folded sections, remembered per person. */
  sections: OpenSections;
};

const Context = createContext<SlackLinkedCapabilities>();

export function SlackLinkedProvider(
  props: ParentProps<{ value: SlackLinkedCapabilities }>
) {
  return (
    <Context.Provider value={props.value}>{props.children}</Context.Provider>
  );
}

export function useSlackLinked() {
  const value = useContext(Context);
  if (!value) throw new Error('SlackLinkedProvider is required');
  return value;
}
