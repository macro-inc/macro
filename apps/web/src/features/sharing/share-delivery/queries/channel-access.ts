import type { ResultError } from '@core/util/result';
import { updateAgentSessionSharePermissions } from '@queries/agent-session/share-permissions';
import { updateInitiativeSharePermissions } from '@queries/initiative/share-permissions';
import { updateDatabaseSharePermissions } from '@queries/storage/databases';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { storageServiceClient } from '@service-storage/client';
import type { UpdateChannelSharePermission } from '@service-storage/generated/schemas/updateChannelSharePermission';
import { err, ok, type Result, type ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type {
  ChannelAccessChange,
  ChannelAccessError,
  ShareItemRef,
  ShareKind,
} from '../core/share-item';

// The database client returns neverthrow's ResultAsync, whose `then` does not
// satisfy TypeScript's PromiseLike. Both await to a Result.
type ChannelGrantClient = (
  id: string,
  operation: UpdateChannelSharePermission
) =>
  | Promise<Result<unknown, readonly ResultError[]>>
  | ResultAsync<unknown, readonly ResultError[]>;

const CHANNEL_GRANT_CLIENTS = {
  document: (documentId, operation) =>
    storageServiceClient.editDocument({
      documentId,
      sharePermission: { channelSharePermissions: [operation] },
    }),
  chat: (chat_id, operation) =>
    cognitionApiServiceClient.updateChatPermissions({
      chat_id,
      sharePermission: { channelSharePermissions: [operation] },
    }),
  project: (id, operation) =>
    storageServiceClient.projects.edit({
      id,
      sharePermission: { channelSharePermissions: [operation] },
    }),
  email: (threadId, operation) =>
    storageServiceClient.editThread({
      threadId,
      sharePermission: { channelSharePermissions: [operation] },
    }),
  agent_session: (id, operation) =>
    updateAgentSessionSharePermissions(id, {
      channelSharePermissions: [operation],
    }),
  database: (id, operation) =>
    updateDatabaseSharePermissions({
      id,
      channelSharePermissions: [operation],
    }),
  initiative: (id, operation) =>
    updateInitiativeSharePermissions(id, {
      channelSharePermissions: [operation],
    }),
  call: undefined,
} satisfies Record<ShareKind, ChannelGrantClient | undefined>;

function toOperation(change: ChannelAccessChange) {
  return match(change)
    .with({ t: 'set' }, ({ channelId, level }) => ({
      operation: 'replace' as const,
      accessLevel: level,
      channelId,
    }))
    .with({ t: 'remove' }, ({ channelId }) => ({
      operation: 'remove' as const,
      channelId,
    }))
    .exhaustive();
}

function refused(errors: readonly ResultError[]) {
  return errors.some(
    ({ code }) => code === 'UNAUTHORIZED' || code === 'FORBIDDEN'
  );
}

export async function changeChannelAccess(
  item: ShareItemRef,
  change: ChannelAccessChange
): Promise<Result<void, ChannelAccessError>> {
  const client: ChannelGrantClient | undefined =
    CHANNEL_GRANT_CLIENTS[item.kind];
  if (!client) return err('unsupported');

  try {
    const result = await client(item.id, toOperation(change));
    if (result.isErr()) {
      console.error('Failed to change channel access', result.error);
      return err(refused(result.error) ? 'not-allowed' : 'failed');
    }
    return ok(undefined);
  } catch (thrown) {
    console.error('Failed to change channel access', thrown);
    return err('failed');
  }
}
