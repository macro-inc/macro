import { analytics } from '@app/lib/analytics';
import { t } from '@app/lib/i18n';
import { makePersistedState } from '@app/lib/persistence';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import LogoIcon from '@icon/macro-logo.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog } from '@ui';
import { createSignal, Show } from 'solid-js';
import { z } from 'zod';
import videoUrl from '../assets/macro-mail-tutorial.mp4';
import posterUrl from '../assets/macro-mail-tutorial-poster.jpg';

const DISMISSED_KEY = 'email-tutorial-row-dismissed';
const DISMISSED_VALUE = z.literal('true');

/**
 * A pinned row at the top of the inbox that opens the Macro Mail tutorial
 * video. It stays until the person dismisses it on this device.
 */
export function EmailTutorialRow() {
  const [open, setOpen] = createSignal(false);
  const [dismissed, setDismissed] = makePersistedState(createSignal(false), {
    storages: {
      restore: () =>
        DISMISSED_VALUE.safeParse(localStorage.getItem(DISMISSED_KEY)).success
          ? true
          : undefined,
      write: (value) => {
        if (value) localStorage.setItem(DISMISSED_KEY, 'true');
      },
    },
  });

  const openVideo = () => {
    analytics.track('tutorial_video', {
      tutorial: 'macro-mail',
      action: 'opened',
    });
    setOpen(true);
  };

  const dismiss = () => {
    analytics.track('tutorial_video', {
      tutorial: 'macro-mail',
      action: 'dismissed',
    });
    setDismissed(true);
  };

  return (
    <Show when={!dismissed()}>
      <div class="soup-row-wide group/tutorial relative mx-(--soup-row-gutter) flex min-h-10 w-[calc(100%-0.5rem)] items-center rounded-xl py-0.5 not-touch:hover:bg-list-hover touch:min-h-[44px]">
        <button
          type="button"
          onClick={openVideo}
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
            <span class="font-semibold text-ink">
              {t('tutorials.learnMacroMail')}
            </span>
            <span class="text-ink-muted">
              {' — '}
              {t('tutorials.learnMacroMailSnippet')}
            </span>
          </span>
          <span class="ml-auto flex shrink-0 items-center gap-1 pr-1 text-xs font-medium text-ink-extra-muted">
            <PlayIcon class="size-3.5" />
            {t('tutorials.macroMailLength')}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('tutorials.dismiss')}
          tooltip={t('tutorials.dismiss')}
          class={
            isTouchDevice()
              ? 'mr-1 shrink-0'
              : 'mr-1 shrink-0 opacity-0 group-hover/tutorial:opacity-100 focus-visible:opacity-100'
          }
          onClick={dismiss}
        >
          <XIcon class="size-4 shrink-0" />
        </Button>
      </div>
      <TutorialVideoDialog open={open()} onOpenChange={setOpen} />
    </Show>
  );
}

/** 80% of the window, with a big play button: the video never autoplays. */
function TutorialVideoDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [started, setStarted] = createSignal(false);
  let video: HTMLVideoElement | undefined;
  // Counted once per opening, and only once playback really starts.
  let playRecorded = false;

  const recordPlay = () => {
    setStarted(true);
    if (playRecorded) return;
    playRecorded = true;
    analytics.track('tutorial_video', {
      tutorial: 'macro-mail',
      action: 'played',
    });
  };

  const play = () => {
    if (!video) return;
    setStarted(true);
    // The play overlay unmounts, so hand focus to the video: Space and Escape keep working.
    video.focus();
    fireAndForget(video.play(), 'email-view');
  };

  const changeOpen = (open: boolean) => {
    if (!open) {
      video?.pause();
      setStarted(false);
      playRecorded = false;
    }
    props.onOpenChange(open);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={changeOpen}
      position="center"
      animate
      class="w-[80vw] max-w-[80vw] mobile:w-full mobile:max-w-full"
    >
      <div class="flex h-[80vh] w-full flex-col mobile:h-auto">
        <div class="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4 mobile:hidden">
          <Dialog.Title class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {t('tutorials.learnMacroMail')}
          </Dialog.Title>
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-md"
            aria-label={t('tutorials.closeVideo')}
          >
            <XIcon class="size-4 shrink-0" />
          </Dialog.CloseButton>
        </div>
        <div class="relative mx-2 mb-2 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[18px] bg-[black] mobile:m-0 mobile:rounded-none">
          <video
            ref={video}
            src={videoUrl}
            poster={posterUrl}
            preload="metadata"
            playsinline
            tabIndex={-1}
            controls={started()}
            onPlay={recordPlay}
            onKeyDown={(event) => {
              if (event.key === 'Escape') changeOpen(false);
            }}
            class="max-h-full w-full object-contain mobile:aspect-video"
          />
          <Show when={!started()}>
            <button
              type="button"
              onClick={play}
              aria-label={t('tutorials.playVideo')}
              class="absolute inset-0 grid place-items-center bg-[black]/30 outline-none"
            >
              <span class="grid size-24 place-items-center rounded-full bg-[white] text-[black] shadow-2xl transition-transform not-touch:hover:scale-105 mobile:size-16">
                <PlayIcon class="ml-1.5 size-10 mobile:size-7" />
              </span>
            </button>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
