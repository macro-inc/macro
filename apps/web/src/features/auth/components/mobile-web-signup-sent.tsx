import LogoIcon from '@icon/macro-logo.svg';

export function MobileWebSignupSent(props: { onBackHome: () => void }) {
  return (
    <div class="flex flex-col size-full p-6 overflow-hidden relative">
      <div class="flex flex-col items-start gap-4 w-full max-w-md mx-auto mt-6">
        <LogoIcon class="size-16 text-accent self-center" />
        <h2 class="text-3xl font-semibold text-ink mt-3">
          Macro is better on desktop.
        </h2>
        <p class="text-base text-ink/60 mt-4">
          We sent a link to your inbox - open it on your computer for the full
          Macro experience.
        </p>

        <button
          type="button"
          onClick={() => props.onBackHome()}
          class="w-full px-3 py-2.5 text-lg font-bold rounded-xs bg-accent text-surface border-none mt-16"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
