import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import PlayIcon from '@icon/system/fill/play-fill.svg';
import VideoIcon from '@icon/system/regular/video-camera.svg';
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
 * A pinned row at the top of a block's list, on the list rows' own grid
 * (WideLayout and the --soup-row-* geometry in entity/composed/ListEntity.css):
 * a play button in the icon slot, "Watch tutorial" in the sender column, the
 * title and snippet where a row's subject goes, and the length where its date
 * goes, so it lines up with the rows below it.
 */
export function TutorialRowView(props: EntryProps) {
  return (
    <div class="soup-row-wide group/tutorial relative mx-(--soup-row-gutter) flex min-h-10 w-[calc(100%-2*var(--soup-row-gutter))] items-center rounded-xl not-touch:hover:bg-list-hover touch:min-h-[44px]">
      <button
        type="button"
        onClick={props.onOpen}
        aria-haspopup="dialog"
        class="grid min-h-[inherit] w-full grid-cols-[var(--soup-row-indicator-width)_1fr_auto_8ch] items-center gap-x-(--soup-row-column-gap) rounded-xl pr-2 pl-(--soup-row-padding-l) text-left text-sm outline-none [--title-width:10rem] focus-visible:bg-list-hover"
      >
        <span aria-hidden="true" />
        <span class="flex min-w-0 items-center gap-2 font-medium">
          <span class="grid size-4 shrink-0 place-items-center rounded-full bg-ink text-surface">
            <PlayIcon class="ml-px size-2" />
          </span>
          <span class="w-(--title-width) shrink-0 truncate text-ink">
            {t('tutorials.watchTutorial')}
          </span>
          <span class="shrink-0 truncate text-ink">{props.title}</span>
          <span class="min-w-0 flex-1 truncate text-ink/50">
            {props.snippet}
          </span>
        </span>
        {/* The dismiss button sits over this column, like a row's hover actions. */}
        <span class="w-7" aria-hidden="true" />
        <span class="flex items-center justify-end gap-1 text-right text-xs font-medium text-ink-extra-muted">
          <VideoIcon class="size-3.5 shrink-0" />
          {props.length}
        </span>
      </button>
      <div class="absolute top-1/2 right-[calc(8ch+0.5rem+var(--soup-row-column-gap))] -translate-y-1/2">
        <DismissButton onDismiss={props.onDismiss} />
      </div>
    </div>
  );
}

/**
 * A compact pill for places with no list to pin a row in: the middle of an
 * empty state, or the top of a sidebar ("▷ Watch tutorial · Learn how to use
 * Macro Chat · 1:12").
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
        <span class="shrink-0 font-semibold text-ink">
          {t('tutorials.watchTutorial')}
        </span>
        <span class="min-w-0 truncate text-ink-muted">{props.title}</span>
        <span class="shrink-0 text-xs font-medium text-ink-extra-muted">
          {props.length}
        </span>
      </button>
      <DismissButton onDismiss={props.onDismiss} />
    </div>
  );
}
