import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import type { EntityData } from '@entity';
import type { EntityActionListState } from './entity-action-context';

export const makeCopyEntityIdAction = (options: { silent?: boolean } = {}) => {
  // A channel message or thread row's id joins its channel's and its own, so
  // it names nothing a user can look up.
  const canExecute = (entity: EntityData): boolean =>
    entity.type !== 'channel_message' && entity.type !== 'channel_thread';

  /** Copying an id needs nothing but the id, so callers that only have one
   *  (e.g. a block, which is keyed by its entity id) can skip resolving the
   *  entity. */
  const executeById = async (id: string) => {
    const copied = await writeClipboardData({ 'text/plain': id });
    if (!copied) {
      toast.failure(t('entityActions.toastCopyFailed', { count: 1 }));
      return false;
    }
    if (!options.silent) toast.success(t('entityActions.toastIdCopied'));
    return true;
  };

  const execute = async (entities: EntityData[]) => {
    const entity = entities[0];
    if (!entity) return;

    return executeById(entity.id);
  };

  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    return execute(entities);
  };

  return { canExecute, execute, executeById, executeWithSoup };
};
