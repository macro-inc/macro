import { t } from '@app/lib/i18n';

/** An artifact whose first version hasn't been published. */
export function NothingPublished() {
  return (
    <div class="flex size-full items-center justify-center p-4 text-sm text-ink-muted">
      {t('artifacts.nothingPublished')}
    </div>
  );
}
