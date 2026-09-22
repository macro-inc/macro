import { ContinueButton } from '../flow/shared';
import { FeatureOverview } from './FeatureOverview';
import { SecurityBadges } from './SecurityBadges';

export function VisionStep(props: { onContinue: () => void }) {
  return <FeatureOverview onContinue={props.onContinue} />;
}

export function SecurityStep(props: { onContinue: () => void }) {
  return (
    <div class="flex flex-col items-center gap-10 text-center">
      <div data-security-scene class="w-full max-w-md py-10">
        <SecurityBadges />
      </div>
      <div class="flex flex-col items-center gap-5">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-4xl font-[315] leading-[1.12] tracking-tight sm:text-5xl"
        >
          A shared system.
          <br />
          Built on trust.
        </h1>
        <p class="max-w-sm text-sm leading-6 text-ink-muted">
          Your company’s knowledge deserves a strong foundation. Security is
          part of the system from the start.
        </p>
      </div>
      <ContinueButton label="Create my team" onClick={props.onContinue} />
    </div>
  );
}
