import { NoiseBackground } from '@app/features/setup/flow/shared';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useIsAuthenticated } from '@core/context/user';
import LogoIcon from '@icon/macro-logo.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import {
  usePublicGtmInviteLinkQuery,
  useRedeemGtmInviteLinkMutation,
} from '@queries/gtm-invite/links';
import type { GtmInviteLinkStatus } from '@service-auth/generated/schemas/gtmInviteLinkStatus';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { Button } from '@ui';
import { createEffect, createMemo, Match, on, onMount, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import {
  clearPendingInviteToken,
  INVITE_TOKEN_PARAM,
  isPlausibleInviteToken,
  SIGNUP_INVITE_PARAM,
  savePendingInviteToken,
} from './core/invite-link';

type WelcomeView =
  | { kind: 'missing' }
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'revoked' }
  | { kind: 'used' }
  | { kind: 'welcome'; firstName: string; freeMonths: number };

/**
 * The public landing page for a GTM invite link (`/invite?token=…`): a
 * personal welcome for the prospect a staff member sent it to. Continue parks
 * the token for the signup that follows; a signed-in visitor (back from SSO,
 * or an existing account) redeems on the spot instead.
 */
export function InviteWelcome() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const isAuthenticated = useIsAuthenticated();

  const token = createMemo(() => {
    const raw = searchParams[INVITE_TOKEN_PARAM];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return isPlausibleInviteToken(value) ? value : undefined;
  });

  const linkQuery = usePublicGtmInviteLinkQuery(token);
  // Guarded reads: a pending query must not suspend the page into the root
  // fallback, and the fetch itself is what the dashboard counts as an open.
  const link = () => (linkQuery.isSuccess ? linkQuery.data : undefined);

  const view = createMemo((): WelcomeView => {
    if (!token()) return { kind: 'missing' };
    if (linkQuery.isError) return { kind: 'invalid' };
    const resolved = link();
    if (!resolved) return { kind: 'loading' };
    // A signed-in visitor may be the recipient coming back from SSO on a link
    // they already redeemed; redemption is idempotent for them.
    if (isAuthenticated() === true && resolved.status === 'redeemed') {
      return {
        kind: 'welcome',
        firstName: resolved.firstName,
        freeMonths: resolved.freeMonths,
      };
    }
    return match<GtmInviteLinkStatus, WelcomeView>(resolved.status)
      .with('active', () => ({
        kind: 'welcome',
        firstName: resolved.firstName,
        freeMonths: resolved.freeMonths,
      }))
      .with('expired', () => ({ kind: 'expired' }))
      .with('revoked', () => ({ kind: 'revoked' }))
      .with('redeemed', 'converted', () => ({ kind: 'used' }))
      .exhaustive();
  });
  const welcomeDetails = () => {
    const current = view();
    return current.kind === 'welcome' ? current : undefined;
  };

  onMount(() => {
    analytics.pageView('gtm_invite_welcome');
  });

  // Analytics on an external system, once the link resolves.
  createEffect(
    on(link, (resolved) => {
      if (!resolved) return;
      analytics.track('gtm_invite_opened', { status: resolved.status });
    })
  );

  const redeem = useRedeemGtmInviteLinkMutation({
    onSuccess: () => {
      clearPendingInviteToken();
    },
    onSettled: () => {
      // Attributed (or not — a failed attempt leaves the parked token for the
      // next authenticated load to retry).
      navigate('/', { replace: true });
    },
  });

  const onContinue = () => {
    const value = token();
    if (!value) return;
    savePendingInviteToken(value);
    analytics.track('gtm_invite_continue', {
      authenticated: isAuthenticated() === true,
    });
    if (isAuthenticated() === true) {
      redeem.mutate({ token: value });
      return;
    }
    navigate(`/signup?${SIGNUP_INVITE_PARAM}=${encodeURIComponent(value)}`);
  };

  return (
    <div class="relative flex size-full items-center justify-center overflow-hidden bg-surface font-sans text-ink">
      <style>{
        /*css*/ `
        @keyframes gtm-card-in {
          from { opacity: 0; transform: translateY(14px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0)    scale(1);     }
        }
        .gtm-card { animation: gtm-card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }
      `
      }</style>

      <NoiseBackground />

      <div class="gtm-card relative z-10 w-full max-w-sm px-4 sm:max-w-lg sm:px-8">
        <div class="flex flex-col gap-8">
          <LogoIcon class="size-12 text-accent" />

          <Switch>
            <Match when={view().kind === 'loading'}>
              <div class="flex flex-col gap-3">
                <div class="h-8 w-56 animate-pulse rounded-md bg-ink/10" />
                <div class="h-4 w-80 max-w-full animate-pulse rounded-md bg-ink/10" />
              </div>
            </Match>

            <Match when={welcomeDetails()}>
              {(details) => (
                <div class="flex flex-col gap-8">
                  <div class="flex flex-col gap-2">
                    <h1 class="text-3xl font-semibold tracking-tight text-ink">
                      Welcome, {details().firstName}
                    </h1>
                    <p class="max-w-md text-sm leading-relaxed text-ink-muted">
                      Your Macro workspace is ready to set up. Bring your email,
                      docs, and team together in one place — and your{' '}
                      {details().freeMonths === 1
                        ? 'first month'
                        : `first ${details().freeMonths} months`}{' '}
                      of Premium {details().freeMonths === 1 ? 'is' : 'are'} on
                      us.
                    </p>
                  </div>
                  <div class="flex flex-col gap-3">
                    <Button
                      variant="cta"
                      size="xl"
                      disabled={redeem.isPending}
                      onClick={onContinue}
                    >
                      {redeem.isPending ? 'One moment…' : 'Continue'}
                      <ArrowRight class="size-5" />
                    </Button>
                    <p class="text-center text-xs text-ink/50">
                      Already have an account?{' '}
                      <A
                        href="/login"
                        class="text-link underline underline-offset-2 hover:text-link-hover"
                        onClick={() => {
                          const value = token();
                          if (value) savePendingInviteToken(value);
                        }}
                      >
                        Log in
                      </A>
                    </p>
                  </div>
                </div>
              )}
            </Match>

            <Match when={view().kind === 'expired'}>
              <UnavailableInvite
                title="This invite link has expired"
                body="Invite links stay open for 48 hours. Ask your Macro contact for a fresh one and we'll pick up right where this one left off."
              />
            </Match>

            <Match when={view().kind === 'used'}>
              <UnavailableInvite
                title="This invite link has already been used"
                body="If that was you, log in to pick up where you left off. Otherwise, ask your Macro contact for a link of your own."
              />
            </Match>

            <Match when={view().kind === 'revoked'}>
              <UnavailableInvite
                title="This invite link is no longer active"
                body="Ask your Macro contact for a new link."
              />
            </Match>

            <Match
              when={view().kind === 'invalid' || view().kind === 'missing'}
            >
              <UnavailableInvite
                title="This invite link isn't valid"
                body="Double-check the link you were sent, or ask your Macro contact for a new one."
              />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}

function UnavailableInvite(props: { title: string; body: string }) {
  const navigate = useNavigate();
  return (
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-ink">
          {props.title}
        </h1>
        <p class="max-w-md text-sm leading-relaxed text-ink-muted">
          {props.body}
        </p>
      </div>
      <div class="flex gap-3">
        <Button variant="outline" size="lg" onClick={() => navigate('/login')}>
          Log in
        </Button>
      </div>
    </div>
  );
}
