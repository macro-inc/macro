import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import VideoIcon from '@icon/system/regular/video-camera.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';

/**
 * The row's icon: an outline play circle on the system icon grid (24 units,
 * 2px stroke), the same size and weight as the envelope and other row icons.
 */
function PlayCircleIcon(props: { class?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cn('shrink-0', props.class)}
    >
      <circle cx="12" cy="12" r="9" />
      <path
        d="M10.25 9.2v5.6a.6.6 0 0 0 .92.5l4.3-2.8a.6.6 0 0 0 0-1l-4.3-2.8a.6.6 0 0 0-.92.5Z"
        fill="currentColor"
        stroke-width="1"
      />
    </svg>
  );
}

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
          <PlayCircleIcon class="size-4 text-ink-muted" />
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
 * For an empty state: a standard secondary button ("▷ Watch tutorial 1:27"),
 * with the dismiss X beside it. The empty state around it names the block.
 */
export function TutorialPillView(props: EntryProps & { class?: string }) {
  return (
    <div class={cn('group/tutorial relative flex items-center', props.class)}>
      <Button
        variant="secondary"
        size="md"
        onClick={props.onOpen}
        aria-haspopup="dialog"
        aria-label={`${t('tutorials.watchTutorial')}: ${props.title}, ${props.length}`}
      >
        <PlayCircleIcon class="size-4" />
        {t('tutorials.watchTutorial')}
        <span class="text-ink-extra-muted">{props.length}</span>
      </Button>
      {/* Hangs outside the button, so the button itself stays centered. */}
      <div class="absolute top-1/2 left-full ml-1 -translate-y-1/2">
        <DismissButton onDismiss={props.onDismiss} />
      </div>
    </div>
  );
}

/**
 * For a sidebar: a sidebar item like the block's own (Inbox, Favorites), with
 * the length in the trailing lane, swapped for the dismiss X on hover.
 */
export function TutorialSidebarItemView(props: EntryProps) {
  return (
    <div class="group/tutorial relative">
      <ViewSidebar.Item
        onClick={props.onOpen}
        aria-haspopup="dialog"
        aria-label={`${t('tutorials.watchTutorial')}: ${props.title}, ${props.length}`}
      >
        <ViewSidebar.Icon>
          <PlayCircleIcon />
        </ViewSidebar.Icon>
        <span class="truncate">{t('tutorials.watchTutorial')}</span>
        <span
          class={cn(
            'ml-auto shrink-0 pr-1 text-xs text-ink-extra-muted',
            isTouchDevice() ? 'invisible' : 'group-hover/tutorial:invisible'
          )}
        >
          {props.length}
        </span>
      </ViewSidebar.Item>
      <div class="absolute top-1/2 right-0 -translate-y-1/2">
        <DismissButton onDismiss={props.onDismiss} />
      </div>
    </div>
  );
}
