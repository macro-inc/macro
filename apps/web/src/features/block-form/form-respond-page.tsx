/**
 * The respond route (RFC 02 §4): `/app/form/:id/respond`. One page, two
 * shells: signed-in visitors see it inside the app shell (sidebar, command
 * menu) with their own header and can edit their response; anonymous
 * visitors get the focused shell, so a public form never meets the login
 * redirect (`routes/focused-shell.ts`). The form itself is the shared
 * `RespondView`.
 */
import { useEmail, useUserId } from '@core/context/user';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import ClipboardText from '@phosphor/clipboard-text.svg';
import { A, useNavigate } from '@solidjs/router';
import { Match, Show, Switch } from 'solid-js';
import { FormProvider } from './context/form-context';
import { createAppFormContext } from './form-context-production';
import { SignInToRespond } from './sign-in-to-respond';
import { FormLoadFailureView, FormSkeleton } from './views/form-page-view';
import { RespondView } from './views/respond-view';

function RespondHeader(props: {
  name: string;
  formId: string;
  isPublic: boolean;
}) {
  const userId = useUserId();
  const email = useEmail();
  return (
    <Switch>
      <Match when={userId()}>
        <header class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span class="font-semibold text-ink">Macro</span>
          <span aria-hidden="true">/</span>
          <span>Forms</span>
          <span aria-hidden="true">/</span>
          <span class="max-w-60 truncate text-ink">{props.name}</span>
          <span class="ml-auto">Responding as {email() ?? 'you'}</span>
          <A
            href={`/form/${encodeURIComponent(props.formId)}`}
            class="inline-flex items-center gap-1 text-link hover:underline"
          >
            Open in Macro
            <ArrowSquareOut class="size-3" aria-hidden="true" />
          </A>
        </header>
      </Match>
      <Match when={!userId()}>
        <header class="flex flex-col gap-2">
          <p class="flex items-center gap-1.5 text-xs text-ink-muted">
            <ClipboardText class="size-3.5 text-violet" aria-hidden="true" />
            Macro Forms
            <Show when={props.isPublic}>
              {' · Public form · you’re responding anonymously'}
            </Show>
          </p>
          <Show when={props.isPublic}>
            <p class="rounded-lg border border-edge-muted bg-panel px-3 py-2 text-xs text-ink-muted">
              Have a Macro account? <SignInToRespond>Sign in</SignInToRespond>{' '}
              to edit your answer later.
            </p>
          </Show>
        </header>
      </Match>
    </Switch>
  );
}

function RespondFooter() {
  return (
    <footer class="mx-auto flex w-full max-w-[680px] flex-col gap-1 px-4 pb-8 text-center text-[11px] text-ink-muted">
      <p>Never submit passwords through Macro Forms.</p>
      <p>
        <a
          href="mailto:abuse@macro.com?subject=Report%20a%20form"
          class="hover:underline"
        >
          Report this form
        </a>
      </p>
    </footer>
  );
}

function FormRespondContent(props: { formId: string }) {
  const navigate = useNavigate();
  const context = createAppFormContext({
    openRelated: (destination) =>
      navigate(`/database/${destination.databaseId}`),
    openChannel: (channelId) => navigate(`/channel/${channelId}`),
  });
  const source = context.createFormSource(() => props.formId);
  return (
    <FormProvider value={context}>
      <main class="h-full min-h-0 overflow-y-auto bg-canvas-base text-ink">
        <Show
          when={source.detail()}
          fallback={
            <Show when={source.failure()} fallback={<FormSkeleton />}>
              {(failure) => (
                <div class="mx-auto flex max-w-[680px] flex-col px-4 py-16">
                  <FormLoadFailureView
                    failure={failure()}
                    onRetry={() => void source.refetch()}
                  />
                  <Show when={failure().kind === 'sign-in'}>
                    <SignInToRespond class="mx-auto text-sm text-link hover:underline">
                      Sign in
                    </SignInToRespond>
                  </Show>
                </div>
              )}
            </Show>
          }
        >
          {(detail) => (
            <>
              <RespondView
                detail={detail()}
                refetch={source.refetch}
                compact={false}
                header={
                  <RespondHeader
                    name={detail().form.name}
                    formId={props.formId}
                    isPublic={detail().form.audience === 'public'}
                  />
                }
              />
              <Show when={detail().form.audience === 'public'}>
                <RespondFooter />
              </Show>
            </>
          )}
        </Show>
      </main>
    </FormProvider>
  );
}

/**
 * Not behind the forms flag: the flag gates authoring, and a public form
 * must open for visitors outside the rollout. The service answers who may
 * respond.
 */
export function FormRespondPage(props: { formId: string }) {
  return <FormRespondContent formId={props.formId} />;
}
