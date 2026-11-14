import { throwOnErr } from '@core/util/result';
import { externalChatsClient } from '@service-storage/external-chats';
import type {
  ExternalChatAdd,
  SlackSessionSubmission,
} from '@service-storage/generated/schemas';
import { slackLinkedClient as client } from '@service-storage/slack-linked';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import { queryClient } from '../client';
import { invalidateExternalChatList } from '../external-chats';
import { slackLinkedKeys } from './keys';
import { slackOperation } from './operation';

/** How often an open sign-in dialog reads a step a replica is working on. */
export const LOGIN_POLL_MS = 1000;

/** How often the catalogue is re-read while Slack is refreshing it. */
export const CATALOGUE_REFRESH_POLL_MS = 2000;

function accountsOptions(userId: string) {
  return queryOptions({
    queryKey: slackLinkedKeys.accounts(userId).queryKey,
    queryFn: () => throwOnErr(client.accounts),
    enabled: !!userId,
    staleTime: 5_000,
  });
}

function loginOptions(userId: string, loginId: string) {
  return queryOptions({
    queryKey: slackLinkedKeys.login(userId, loginId).queryKey,
    queryFn: () => throwOnErr(() => client.login(loginId)),
    enabled: !!userId && !!loginId,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    // Only a replica moves a `working` step; every other step waits for the
    // person, who answers through a mutation that returns the next step.
    refetchInterval: (query) =>
      query.state.status !== 'error' &&
      query.state.data?.step.kind === 'working'
        ? LOGIN_POLL_MS
        : false,
    refetchIntervalInBackground: false,
  });
}

function conversationsOptions(userId: string, enabled: boolean) {
  return queryOptions({
    queryKey: slackLinkedKeys.conversations(userId).queryKey,
    queryFn: () => throwOnErr(client.conversations),
    enabled: !!userId && enabled,
    staleTime: 10_000,
    refetchInterval: (query) =>
      query.state.data?.refreshing ? CATALOGUE_REFRESH_POLL_MS : false,
  });
}

/** Every Slack workspace the person signed in to, in any state. */
export function useSlackAccountsQuery(userId: Accessor<string>) {
  return useQuery(() => accountsOptions(userId()));
}

/** One sign-in attempt, read while its dialog is open; never cached. */
export function useSlackLoginQuery(
  userId: Accessor<string>,
  loginId: Accessor<string>
) {
  return useQuery(() => loginOptions(userId(), loginId()));
}

/** The Slack Connect conversations of the person's connected workspaces. */
export function useSlackConversationsQuery(
  userId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => conversationsOptions(userId(), enabled()));
}

const invalidateAccounts = () =>
  queryClient.invalidateQueries({ queryKey: slackLinkedKeys.accounts._def });
const invalidateConversations = () =>
  queryClient.invalidateQueries({
    queryKey: slackLinkedKeys.conversations._def,
  });

/** A sign-in finished: the accounts and their conversations changed. */
export function refreshSlackAccounts() {
  return Promise.all([invalidateAccounts(), invalidateConversations()]);
}

/** Each step answer returns the attempt's next step; the dialog shows it. */
function storeLogin(userId: string) {
  return (login: { id: string }) =>
    queryClient.setQueryData(
      slackLinkedKeys.login(userId, login.id).queryKey,
      login
    );
}

export type SlackLoginInput =
  | { step: 'email'; email: string }
  | { step: 'session'; session: SlackSessionSubmission }
  | { step: 'captcha'; loginId: string; solution: string }
  | { step: 'code'; loginId: string; code: string }
  | { step: 'workspaces'; loginId: string; teamIds: string[] }
  | { step: 'two_factor'; loginId: string; code: string }
  | { step: 'cancel'; loginId: string };

function submitLogin(input: SlackLoginInput) {
  return match(input)
    .with({ step: 'email' }, ({ email }) => client.startEmailLogin(email))
    .with({ step: 'session' }, ({ session }) =>
      client.startSessionLogin(session)
    )
    .with({ step: 'captcha' }, ({ loginId, solution }) =>
      client.submitCaptcha(loginId, solution)
    )
    .with({ step: 'code' }, ({ loginId, code }) =>
      client.submitCode(loginId, code)
    )
    .with({ step: 'workspaces' }, ({ loginId, teamIds }) =>
      client.pickWorkspaces(loginId, teamIds)
    )
    .with({ step: 'two_factor' }, ({ loginId, code }) =>
      client.submitTwoFactor(loginId, code)
    )
    .with({ step: 'cancel' }, ({ loginId }) => client.cancelLogin(loginId))
    .exhaustive((unknown) => {
      // The page builds these inputs, so an unknown step is a bug here.
      throw new Error(
        `Unsupported Slack sign-in step: ${JSON.stringify(unknown)}`
      );
    });
}

/** Starts or answers a sign-in step; inputs never reach telemetry. */
export function useSlackLoginMutation(userId: Accessor<string>) {
  return useMutation(() => ({
    mutationFn: (input: SlackLoginInput) =>
      slackOperation(
        `login.${input.step}`,
        () => throwOnErr(() => submitLogin(input)),
        input.step === 'session' ? { 'slack.source': input.session.source } : {}
      ),
    onSuccess: storeLogin(userId()),
  }));
}

export function useDisconnectSlackMutation() {
  return useMutation(() => ({
    mutationFn: (input: {
      accountId: string;
      authorizationGeneration: number;
      signOut: boolean;
    }) =>
      slackOperation(
        'disconnect',
        () =>
          throwOnErr(() =>
            client.disconnect(input.accountId, {
              authorizationGeneration: input.authorizationGeneration,
              signOut: input.signOut,
            })
          ),
        { 'slack.account_id': input.accountId }
      ),
    onSuccess: refreshSlackAccounts,
  }));
}

/** Adds a Slack Connect conversation to Macro as an external chat. */
export function useAddSlackChatMutation() {
  return useMutation(() => ({
    mutationFn: (chat: Omit<ExternalChatAdd, 'provider'>) =>
      slackOperation('add_chat', () =>
        throwOnErr(() =>
          externalChatsClient.add({ provider: 'slack', ...chat })
        )
      ),
    onSuccess: () =>
      Promise.all([invalidateConversations(), invalidateExternalChatList()]),
  }));
}

/** Imports another page of a chat's earlier messages from Slack. */
export function useImportSlackHistoryMutation() {
  return useMutation(() => ({
    mutationFn: (chatId: string) =>
      slackOperation(
        'import_history',
        () => throwOnErr(() => client.importHistory(chatId)),
        { 'external_chat.id': chatId }
      ),
    onSettled: invalidateExternalChatList,
  }));
}
