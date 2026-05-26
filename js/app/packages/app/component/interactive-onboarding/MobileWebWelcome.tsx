import { useAnalytics } from '@app/component/analytics-context';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import LogoIcon from '@icon/macro-logo.svg';
import { A } from '@solidjs/router';
import { createSignal, onMount } from 'solid-js';

interface MobileWebWelcomeProps {
  onSignUp: (email: string) => void;
}

export default function MobileWebWelcome(props: MobileWebWelcomeProps) {
  const analytics = useAnalytics();
  const [email, setEmail] = createSignal('');

  onMount(() => {
    analytics.track('mobile_web_welcome_viewed');
    analytics.track('onboarding_step_welcome', {
      id: 'welcome',
      index: 0,
      state: 'viewed',
    });
  });

  const handleSignUp = () => {
    props.onSignUp(email());
  };

  return (
    <div class="flex flex-col size-full p-6 overflow-hidden relative">
      <div class="inset-0 absolute text-edge bg-surface opacity-10 -z-1">
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
        <h2 class="text-3xl font-semibold text-ink mt-3">Welcome to Macro.</h2>
        <p class="text-base text-ink/60 mt-4">
          Macro is a unified system for work{'\u2060'}—built for{' '}
          <strong>speed</strong> and <strong>focus</strong>.
        </p>

        <form
          class="w-full flex flex-col gap-5 mt-10"
          onSubmit={(e) => {
            e.preventDefault();
            handleSignUp();
          }}
        >
          <input
            type="email"
            aria-label="Email address"
            placeholder="name@company.com"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            class="w-full px-3 py-2.5 text-base border border-edge-muted rounded-lg bg-surface text-ink placeholder:text-ink/30 outline-none focus:border-accent"
          />
          <button
            type="submit"
            class="w-full px-3 py-2.5 text-lg font-bold rounded-xs bg-accent text-surface border-none"
          >
            Sign Up
          </button>
        </form>

        <p class="text-sm text-ink/50 mt-20">Already have an account?</p>
        <A
          href="/login"
          onClick={() => analytics.track('login_from_onboarding')}
          class="w-full px-3 py-2.5 text-lg rounded-xs flex items-center justify-between gap-2 border-none bg-transparent text-ink/50 hover:bg-hover/60 ring-1 ring-edge-muted"
        >
          Login
        </A>
      </div>
    </div>
  );
}
