/** The other ways in, pinned below the first slide. */
export function SignInInstead(props: {
  onSignIn: () => void;
  onAgentSignup: () => void;
}) {
  return (
    <div class="absolute bottom-[30px] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 whitespace-nowrap text-xs leading-5 text-ink-extra-muted">
      <p>
        Already have an account?{' '}
        <button
          type="button"
          class="rounded-sm text-ink-muted underline underline-offset-2 transition-colors hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink-muted"
          onClick={() => props.onSignIn()}
        >
          Sign in instead
        </button>
      </p>
      <p>
        Are you an AI agent?{' '}
        <button
          type="button"
          class="rounded-sm text-ink-muted underline underline-offset-2 transition-colors hover:text-ink focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink-muted"
          onClick={() => props.onAgentSignup()}
        >
          Sign up as agent
        </button>
      </p>
    </div>
  );
}
