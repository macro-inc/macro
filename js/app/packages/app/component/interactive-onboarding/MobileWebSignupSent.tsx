import { onMount } from 'solid-js';
import LogoIcon from '@macro-icons/macro-logo.svg';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { useAnalytics } from '@app/component/analytics-context';
import { getWebOrigin } from '@core/util/webOrigin';
import { MOBILE_WEB_SIGNUP_LEAD_VALUE } from '@app/lib/analytics/leadValues';

export default function MobileWebSignupSent() {
  const analytics = useAnalytics();

  onMount(() => {
    analytics.track('mobile_web_signup_sent_viewed');
    analytics.trackMeta('Lead', {
      content_name: 'mobile_web_signup',
      value: MOBILE_WEB_SIGNUP_LEAD_VALUE,
      currency: 'USD',
    });
  });

  return (
    <div class="flex flex-col h-full w-full p-6 overflow-hidden relative">
      <div class="inset-0 absolute text-edge bg-panel opacity-10 -z-1">
        <PcNoiseGrid
          cellSize={30}
          warp={0}
          crunch={0.2}
          freq={0.001}
          size={[0, 0.3]}
          rounding={0}
          fill={0}
          stroke={1}
          speed={[0.017, 0.209]}
        />
      </div>

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
          onClick={() => {
            window.location.href = getWebOrigin();
          }}
          class="w-full px-3 py-2.5 text-lg font-bold rounded-xs bg-accent text-panel border-none mt-16"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
