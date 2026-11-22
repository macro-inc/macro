import { t } from '@app/lib/i18n';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Button } from '@ui';
import type { JSX } from 'solid-js';

/**
 * The footer of a reply whose draft a session wrote: that it did, the items
 * it drew on beside the thread (the children), and a way to have it rewritten.
 */
export function DraftOriginBar(props: {
  children?: JSX.Element;
  onRewrite(): void;
}) {
  return (
    <div
      class="flex min-w-0 items-center gap-2 py-1.5 pr-2 pl-4 text-sm"
      data-draft-origin
    >
      <SparkleIcon
        class="size-3.5 shrink-0 text-violet-ink"
        aria-hidden="true"
      />
      <span class="shrink-0 text-violet-ink">
        {t('suggestions.draftedByMacro')}
      </span>
      <span class="shrink-0 text-ink-extra-muted">
        {t('suggestions.draftedFromThread')}
      </span>
      <div class="flex min-w-0 flex-1 items-center gap-3 text-ink-muted">
        {props.children}
      </div>
      <Button
        variant="ghost"
        size="sm"
        tooltip={t('suggestions.rewriteDraftHint')}
        onClick={props.onRewrite}
      >
        <ArrowsClockwiseIcon class="size-3.5" />
        {t('suggestions.rewriteDraft')}
      </Button>
    </div>
  );
}
