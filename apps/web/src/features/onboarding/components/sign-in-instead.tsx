/** For returning users who landed on sign-up, pinned below the first slide. */
export function SignInInstead(props: { onSignIn: () => void }) {
  return (
    <p class="absolute bottom-[30px] left-1/2 -translate-x-1/2 whitespace-nowrap text-xs leading-5 text-ink-extra-muted">
      Already have an account?{' '}
      <button
        type="button"
        class="rounded-sm text-ink-muted underline underline-offset-2 transition-colors hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink-muted"
        onClick={() => props.onSignIn()}
      >
        Sign in instead
      </button>
    </p>
  );
}
