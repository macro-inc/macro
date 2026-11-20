/**
 * Writes made from inside an app, through the app's own mutation paths (the
 * functions its menus and editors call), so each side applies its own
 * optimistic updates, cache writes and refreshes. Used for the read-after-own-
 * write checks; other writes go straight to the services from the driver, as
 * another device would make them. None of these modules changed in the PR, so
 * both sides run the same write code against their own readers.
 */
import { createRenameDssEntityMutation } from '@app/features/entity/queries/rename';
import { renameAgentSession } from '@queries/agent-session/entity-mutations';
import { postNewHistoryItem } from '@queries/history/history';
import { updateNotificationsForEntities } from '@queries/notification/entity-mutations';
import { moveEntity, updateEntitySharePolicy } from '@queries/storage/entity-mutations';
import { mountWith } from './common';

// biome-ignore lint/suspicious/noExplicitAny: probe parameters are JSON
type Params = any;

type RenameMutation = ReturnType<typeof createRenameDssEntityMutation>;
let rename: RenameMutation | undefined;

/** The rename mutation is a hook: mount it once, under the app's providers. */
function renameMutation(): RenameMutation {
  if (rename) return rename;
  mountWith(
    '__writes',
    () => {
      rename = createRenameDssEntityMutation();
      return () => ({ settled: true, data: null, caller: null, status: {} });
    },
    { quickAccess: true }
  );
  if (!rename) throw new Error('rename mutation did not mount');
  return rename;
}

export async function runWrite(op: string, p: Params): Promise<unknown> {
  switch (op) {
    case 'rename': {
      const result = await renameMutation().mutateAsync({
        entity: { id: p.id, type: p.type, name: p.oldName ?? '' },
        newName: p.name,
      } as never);
      if (!(result as { success?: boolean }).success) throw new Error(`rename failed ${JSON.stringify(result)}`);
      return result;
    }
    case 'renameSession':
      return await renameAgentSession(p.id, p.name);
    case 'move':
      return await moveEntity({ type: p.type, id: p.id }, p.projectId ?? null);
    case 'share': {
      const result = await updateEntitySharePolicy(p.itemType, p.id, p.request);
      if (result.isErr()) throw new Error(`share failed ${JSON.stringify(result.error).slice(0, 300)}`);
      return true;
    }
    case 'markRead':
      return (
        await updateNotificationsForEntities({
          entities: p.entities,
          operation: p.operation,
        })
      ).length;
    case 'view':
      return await postNewHistoryItem(p.itemType, p.id);
    default:
      throw new Error(`unknown write ${op}`);
  }
}
