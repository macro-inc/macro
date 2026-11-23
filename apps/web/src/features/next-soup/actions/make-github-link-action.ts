import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { writeClipboardData } from '@core/util/dataTransfer';
import { openExternalUrl } from '@core/util/url';
import { type EntityData, isGithubPrEntity } from '@entity';

/** A pull request's own GitHub page: open it, or copy its address. */
export const makeGithubLinkAction = (options: { silent?: boolean } = {}) => {
  const canExecute = (entity: EntityData): boolean =>
    isGithubPrEntity(entity) && entity.metadata.url.length > 0;

  const open = (entity: EntityData) => {
    if (!isGithubPrEntity(entity)) return;
    openExternalUrl(entity.metadata.url);
  };

  const copy = async (entity: EntityData) => {
    if (!isGithubPrEntity(entity)) return;
    const copied = await writeClipboardData({
      'text/plain': entity.metadata.url,
    });
    if (!copied) {
      toast.failure(t('entityActions.toastGithubLinkCopyFailed'));
      return false;
    }
    if (!options.silent)
      toast.success(t('entityActions.toastGithubLinkCopied'));
    return true;
  };

  return { canExecute, open, copy };
};
