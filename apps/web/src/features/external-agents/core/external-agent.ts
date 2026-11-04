/** Harness slug of agents whose runtime lives outside Macro. */
export const EXTERNAL_HARNESS = 'external';

/** An agent whose runtime lives outside Macro. */
export type ExternalAgent = {
  id: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  teamId?: string;
  /** Where its events are pushed; absent while its runtime polls. */
  endpoint?: { url: string; verified: boolean };
};

/** Secrets handed over once, when they are minted. */
export type ExternalAgentCredentials = {
  agent: ExternalAgent;
  botToken?: string;
  signingSecret?: string;
};

/** The GraphQL endpoint an agent's runtime calls with its bot token. */
export function agentApiUrl(storageHost: string): string {
  return `${storageHost}/items/soup/graphql`;
}

/** A reply to one inbox event, as a shell command a developer can paste. */
export function replyExample(apiUrl: string, botToken: string): string {
  const query =
    'mutation($input: ReplyToExternalAgentEventInput!) { replyToExternalAgentEvent(input: $input) { messageId } }';
  const body = JSON.stringify({
    query,
    variables: { input: { eventId: '<event_id>', text: 'Hello from outside' } },
  });
  return [
    `curl -X POST '${apiUrl}' \\`,
    `  -H 'x-macro-bot-token: ${botToken}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${body}'`,
  ].join('\n');
}

/** The handle a name suggests: lowercase letters, digits, and dashes. */
export function handleFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
