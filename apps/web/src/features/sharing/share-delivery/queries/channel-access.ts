import { updatePipelineSharePermissions } from '@app/features/crm/sharing-adapter';
import type { ResultError } from '@core/util/result';
import { updateAgentSessionSharePermissions } from '@queries/agent-session/share-permissions';
import { updateInitiativeSharePermissions } from '@queries/initiative/share-permissions';
import { updateDatabaseSharePermissions } from '@queries/storage/databases';
import { updateFormSharePermissions } from '@queries/storage/forms';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { storageServiceClient } from '@service-storage/client';
import type { UpdateChannelSharePermission } from '@service-storage/generated/schemas/updateChannelSharePermission';
import { err, type Result, ResultAsync } from 'neverthrow';
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
  form: (id, operation) =>
    updateFormSharePermissions({ id, channelSharePermissions: [operation] }),
  crm_pipeline: (id, operation) =>
    updatePipelineSharePermissions(id, {
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

const callClient = ResultAsync.fromThrowable(
  async (
    client: ChannelGrantClient,
    id: string,
    operation: UpdateChannelSharePermission
  ) => await client(id, operation),
  (thrown): ChannelAccessError => {
    console.error('Failed to change channel access', thrown);
    return { kind: 'failed' };
  }
);

export async function changeChannelAccess(
  item: ShareItemRef,
  change: ChannelAccessChange
): Promise<Result<void, ChannelAccessError>> {
  const client: ChannelGrantClient | undefined =
    CHANNEL_GRANT_CLIENTS[item.kind];
  if (!client) return err({ kind: 'unsupported' });

  return await callClient(client, item.id, toOperation(change)).andThen(
    (result) =>
      result
        .map(() => undefined)
        .mapErr((errors): ChannelAccessError => {
          console.error('Failed to change channel access', errors);
          return refused(errors) ? { kind: 'not-allowed' } : { kind: 'failed' };
        })
  );
}
