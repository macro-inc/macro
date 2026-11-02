import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { openExternalUrl } from '@core/util/url';
import { type EntityData, isGithubPrEntity } from '@entity';

/** A pull request's own GitHub page: open it, or copy its address. */
export const makeGithubLinkAction = () => {
  const canExecute = (entity: EntityData): boolean =>
    isGithubPrEntity(entity) && entity.metadata.url.length > 0;

  const open = (entity: EntityData) => {
    if (!isGithubPrEntity(entity)) return;
    openExternalUrl(entity.metadata.url);
  };

  const copy = async (entity: EntityData) => {
    if (!isGithubPrEntity(entity)) return;
    await navigator.clipboard.writeText(entity.metadata.url);
    toast.success(t('entityActions.toastGithubLinkCopied'));
  };

  return { canExecute, open, copy };
};
