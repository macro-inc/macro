import { t } from '@app/lib/i18n';
import { useSidePanel } from '@components/app/side-panel';
import { Button } from '@ui';

/** Lives below the workspace's Details provider, including standalone previews. */
export function ProjectDetailsAction() {
  const details = useSidePanel();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => details?.setIsOpen(true)}
    >
      {t('common.more')}
    </Button>
  );
}
