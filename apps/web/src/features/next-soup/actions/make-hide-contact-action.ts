import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { directMessageCounterparty } from '@queries/contacts/hidden';

type MakeHideContactActionOptions = {
  viewerId: () => string | undefined;
  setHidden: (userId: string) => Promise<unknown>;
  muteChannel: (entity: EntityData) => Promise<unknown>;
};

/** Hides the other person in a one-to-one direct message. */
export function makeHideContactAction(options: MakeHideContactActionOptions) {
  const contactId = (entity: EntityData) =>
    entity.type === 'channel'
      ? directMessageCounterparty(entity, options.viewerId())
      : undefined;

  const canExecute = (entity: EntityData) => contactId(entity) !== undefined;

  const execute = async (entities: EntityData[]) => {
    const entity = entities[0];
    if (!entity) return;
    const userId = contactId(entity);
    if (!userId) return;

    try {
      await options.setHidden(userId);
    } catch {
      toast.failure(t('entityActions.toastContactHiddenFailed'));
      return;
    }

    try {
      await options.muteChannel(entity);
    } catch {
      // The contact is already hidden. Notifications can be muted from the
      // conversation if this write did not land.
    }
    toast.success(t('entityActions.toastContactHidden'));
  };

  return { canExecute, execute };
}
