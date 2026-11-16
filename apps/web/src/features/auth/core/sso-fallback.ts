import { match } from 'ts-pattern';

/**
 * What to tell someone whose Google or Microsoft sign-in came back without
 * completing (`?sso_error=` from the auth service), on the email step it
 * falls back to. Undefined when there was no failed sign-in.
 */
export function ssoFallbackNotice(error: string | undefined) {
  if (!error) return undefined;
  return match(error)
    .with(
      'admin_consent_required',
      () =>
        'Your organization needs an admin to approve Macro. Continue with your email instead.'
    )
    .with(
      'cancelled',
      () => 'Sign-in was cancelled. Continue with your email instead.'
    )
    .otherwise(
      () => "That sign-in didn't go through. Continue with your email instead."
    );
}
