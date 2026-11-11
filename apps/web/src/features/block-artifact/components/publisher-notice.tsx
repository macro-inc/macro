import { t } from '@app/lib/i18n';
import WarningCircle from '@icon/system/regular/warning-circle.svg';
import { Tooltip } from '@ui';
import { Show } from 'solid-js';

/**
 * Who published the page, and for viewers outside the owner's team that it
 * is user-generated, so a page can't pass itself off as Macro.
 */
export function PublisherNotice(props: {
  publisher: string;
  userGenerated: boolean;
}) {
  return (
    <span class="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
      <Show when={props.publisher}>
        <span class="truncate touch:hidden">
          {t('artifacts.publishedBy', { name: props.publisher })}
        </span>
      </Show>
      <Show when={props.userGenerated}>
        <Tooltip
          as="span"
          label={t('artifacts.userGeneratedHint')}
          tabIndex={0}
          class="flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-warning"
        >
          <WarningCircle class="size-3.5 shrink-0" />
          <span class="touch:sr-only">{t('artifacts.userGenerated')}</span>
        </Tooltip>
      </Show>
    </span>
  );
}
