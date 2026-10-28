import LogoIcon from '@icon/macro-logo.svg';

/** The quiet placeholder while a step's data is still on its way. */
export function StepFallback() {
  return (
    <div
      role="status"
      aria-label="Loading setup"
      class="flex justify-center py-10"
    >
      <LogoIcon class="size-6 animate-pulse text-ink/30" />
    </div>
  );
}
