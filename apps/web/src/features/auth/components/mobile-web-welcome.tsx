import LogoIcon from '@icon/macro-logo.svg';
import { createSignal } from 'solid-js';

export function MobileWebWelcome(props: {
  pending: boolean;
  onSignUp: (email: string) => void;
  onLogin: () => void;
}) {
  const [email, setEmail] = createSignal('');

  const handleSignUp = () => {
    props.onSignUp(email());
  };

  return (
    <div class="flex flex-col size-full p-6 overflow-hidden relative">
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
            class="w-full px-3 py-2.5 text-base border border-edge-muted rounded-lg bg-surface text-ink placeholder:text-ink-placeholder outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={props.pending}
            class="w-full px-3 py-2.5 text-lg font-bold rounded-xs bg-accent text-surface border-none"
          >
            Sign Up
          </button>
        </form>

        <p class="text-sm text-ink/50 mt-20">Already have an account?</p>
        <a
          href="/app/login"
          onClick={(event) => {
            event.preventDefault();
            props.onLogin();
          }}
          class="w-full px-3 py-2.5 text-lg rounded-xs flex items-center justify-between gap-2 border border-edge-muted bg-transparent text-ink/50 hover:bg-hover/60"
        >
          Login
        </a>
      </div>
    </div>
  );
}
