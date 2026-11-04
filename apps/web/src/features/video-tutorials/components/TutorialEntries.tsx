import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import LogoIcon from '@icon/macro-logo.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';

type EntryProps = {
  title: string;
  snippet: string;
  length: string;
  onOpen: () => void;
  onDismiss: () => void;
};

/** Shows the dismiss X on hover on desktop, always on touch (no hover there). */
function DismissButton(props: { onDismiss: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('tutorials.dismiss')}
      tooltip={t('tutorials.dismiss')}
      class={cn(
        'mr-1 shrink-0',
        !isTouchDevice() &&
          'opacity-0 focus-visible:opacity-100 group-hover/tutorial:opacity-100'
      )}
      onClick={props.onDismiss}
    >
      <XIcon class="size-4 shrink-0" />
    </Button>
  );
}

/**
 * A pinned row at the top of a block's list, styled like the list's own rows
 * ("Macro · Learn how to use Macro Mail — snippet · ▷ 1:27").
 */
export function TutorialRowView(props: EntryProps) {
  return (
    <div class="soup-row-wide group/tutorial relative mx-(--soup-row-gutter) flex min-h-10 w-[calc(100%-0.5rem)] items-center rounded-xl py-0.5 not-touch:hover:bg-list-hover touch:min-h-[44px]">
      <button
        type="button"
        onClick={props.onOpen}
        aria-haspopup="dialog"
        class="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-xl pl-3 text-left text-sm outline-none focus-visible:bg-list-hover"
      >
        <span class="grid size-5 shrink-0 place-items-center rounded-md bg-ink text-surface">
          <LogoIcon class="size-3" />
        </span>
        <span class="shrink-0 font-semibold text-ink">
          {t('tutorials.from')}
        </span>
        <span class="min-w-0 truncate">
          <span class="font-semibold text-ink">{props.title}</span>
          <span class="text-ink-muted">
            {' — '}
            {props.snippet}
          </span>
        </span>
        <span class="ml-auto flex shrink-0 items-center gap-1 pr-1 text-xs font-medium text-ink-extra-muted">
          <PlayIcon class="size-3.5" />
          {props.length}
        </span>
      </button>
      <DismissButton onDismiss={props.onDismiss} />
    </div>
  );
}

/**
 * A compact pill for places with no list to pin a row in: the middle of an
 * empty state, or the top of a sidebar ("▷ Learn how to use Macro Chat · 1:12").
 */
export function TutorialPillView(props: EntryProps & { class?: string }) {
  return (
    <div
      class={cn(
        'group/tutorial flex max-w-full items-center rounded-full border border-edge-muted bg-surface not-touch:hover:bg-hover',
        props.class
      )}
    >
      <button
        type="button"
        onClick={props.onOpen}
        aria-haspopup="dialog"
        class="flex min-w-0 flex-1 items-center gap-2 rounded-full py-1.5 pr-1 pl-1.5 text-left text-sm outline-none focus-visible:bg-hover touch:min-h-[44px]"
      >
        <span class="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-surface">
          <PlayIcon class="ml-0.5 size-3" />
        </span>
        <span class="min-w-0 truncate font-medium text-ink">{props.title}</span>
        <span class="shrink-0 text-xs font-medium text-ink-extra-muted">
          {props.length}
        </span>
      </button>
      <DismissButton onDismiss={props.onDismiss} />
    </div>
  );
}
