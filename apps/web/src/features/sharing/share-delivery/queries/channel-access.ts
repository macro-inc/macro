import { updatePipelineSharePermissions } from '@app/features/crm/sharing-adapter';
import type { ResultError } from '@core/util/result';
import { updateAgentSessionSharePermissions } from '@queries/agent-session/share-permissions';
import { updateInitiativeSharePermissions } from '@queries/initiative/share-permissions';
import { updateDatabaseSharePermissions } from '@queries/storage/databases';
import { updateEntitySharePolicy } from '@queries/storage/entity-mutations';
import { updateFormSharePermissions } from '@queries/storage/forms';
import type { UpdateChannelSharePermission } from '@service-storage/generated/schemas/updateChannelSharePermission';
import { err, type Result, ResultAsync } from 'neverthrow';
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
  document: (id, operation) =>
    updateEntitySharePolicy('document', id, {
      channelSharePermissions: [operation],
    }),
  chat: (id, operation) =>
    updateEntitySharePolicy('chat', id, {
      channelSharePermissions: [operation],
    }),
  project: (id, operation) =>
    updateEntitySharePolicy('project', id, {
      channelSharePermissions: [operation],
    }),
  email: (id, operation) =>
    updateEntitySharePolicy('email', id, {
      channelSharePermissions: [operation],
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
  foreign: undefined,
} satisfies Record<ShareKind, ChannelGrantClient | undefined>;

function toOperation(
  change: ChannelAccessChange
): UpdateChannelSharePermission {
  if (change.t === 'remove')
    return { operation: 'remove', channelId: change.channelId };
  return {
    operation: 'replace',
    accessLevel: change.level,
    channelId: change.channelId,
  };
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
