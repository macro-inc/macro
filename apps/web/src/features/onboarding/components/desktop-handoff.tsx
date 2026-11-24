import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import { MacroMarkIcon } from './macro-mark-icon';

/**
 * The last screen for someone who onboarded in a phone browser: the app is
 * one tap away, and the browser still works.
 */
export function DesktopHandoff(props: {
  storeUrl: string;
  onDownloadApp: () => void;
  onContinue: () => void;
}) {
  return (
    <div class="mx-auto flex w-full max-w-lg flex-col items-center py-2 text-center">
      <div
        aria-hidden="true"
        class="flex size-16 items-center justify-center rounded-[18px] text-ink"
        style={{
          background:
            'var(--onboarding-intro-background, linear-gradient(145deg, #1c1c1c, #090909 65%))',
          'box-shadow':
            'var(--onboarding-intro-shadow, inset .5px .5px 1px #ffffff1c, inset -.5px -.5px 1px #0008, 0 1px 1px #131313, 0 4px 10px #0005)',
        }}
      >
        <MacroMarkIcon class="h-6 w-8 overflow-visible" />
      </div>
      <h1
        tabindex="-1"
        class="mt-8 font-[Roboto_Slab_Variable] text-[clamp(26px,7.4vw,30px)] font-[315] leading-[1.2] tracking-[-.025em] outline-none [text-wrap:balance]"
      >
        Macro is better on desktop.
      </h1>
      <p class="mt-5 max-w-[340px] font-[Inter_Variable] text-sm leading-6 text-ink-muted [text-wrap:balance]">
        Your workspace is ready. Open macro.com on your computer, and get the
        app to keep up from your phone.
      </p>
      <div class="mt-9 flex w-full max-w-xs flex-col items-stretch gap-3">
        <a
          href={props.storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => props.onDownloadApp()}
          class="flex min-h-14 items-center justify-center gap-3 rounded-full bg-ink px-6 py-4 text-base font-medium text-surface transition-opacity not-touch:hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <DownloadIcon class="size-5 shrink-0" aria-hidden="true" />
          Download app
        </a>
        <button
          type="button"
          onClick={() => props.onContinue()}
          class="flex min-h-14 items-center justify-center gap-3 rounded-full border border-edge bg-surface px-6 py-4 text-base font-medium text-ink transition-colors not-touch:hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          Continue in browser
          <ArrowRightIcon class="size-5 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
