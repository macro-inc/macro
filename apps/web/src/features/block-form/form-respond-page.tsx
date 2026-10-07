/**
 * The respond route (RFC 02 §4): `/app/form/:id/respond`. One page, two
 * shells: signed-in visitors see it inside the app shell (sidebar, command
 * menu) and can edit their response; anonymous
 * visitors get the focused shell, so a public form never meets the login
 * redirect (`routes/focused-shell.ts`). The form itself is the shared
 * `RespondView`.
 */
import { settingsTabToSlug } from '@core/constant/settingsTabsConfig';
import { useUserId } from '@core/context/user';
import Eye from '@phosphor/eye.svg';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { Button, Layer } from '@ui';
import { Show } from 'solid-js';
import { FormProvider } from './context/form-context';
import { createAppFormContext } from './form-context-production';
import { SignInToRespond } from './sign-in-to-respond';
import { FormLoadFailureView, FormSkeleton } from './views/form-page-view';
import { RespondView } from './views/respond-view';

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
  const userId = useUserId();
  const [searchParams] = useSearchParams();
  const preview = () => searchParams.preview === 'true';
  const context = createAppFormContext({
    openRelated: (destination) =>
      navigate(`/database/${destination.databaseId}`),
    openChannel: (channelId) => navigate(`/channel/${channelId}`),
    openCalendarSettings: () =>
      navigate(`/settings/${settingsTabToSlug('Booking links')}`),
  });
  const source = context.createFormSource(() => props.formId);
  return (
    <FormProvider value={context}>
      <Layer depth={1}>
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
              <Show
                when={!preview() || detail().access !== 'view'}
                fallback={
                  <div class="mx-auto max-w-[680px] px-4 py-16">
                    <FormLoadFailureView
                      failure={{ kind: 'forbidden' }}
                      onRetry={() => void source.refetch()}
                    />
                  </div>
                }
              >
                {/* A preview answers nothing for real: switching to or from it
                  in this mounted route starts the form again. */}
                <Show
                  when={preview()}
                  fallback={
                    <RespondView
                      detail={detail()}
                      refetch={source.refetch}
                      compact={false}
                    />
                  }
                >
                  <RespondView
                    detail={detail()}
                    refetch={source.refetch}
                    compact={false}
                    preview
                    header={
                      <header class="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
                        <span class="flex items-center gap-2">
                          <Eye class="size-4" />
                          Preview · responses won’t be saved
                        </span>
                        <Button
                          variant="outline"
                          onClick={() =>
                            navigate(
                              `/form/${encodeURIComponent(props.formId)}`
                            )
                          }
                        >
                          Back to builder
                        </Button>
                      </header>
                    }
                  />
                </Show>
                <Show when={!preview() && detail().form.audience === 'public'}>
                  <Show when={!userId()}>
                    <p class="mx-auto mb-6 max-w-3xl px-6 text-center text-xs text-ink-muted">
                      You’re responding anonymously.{' '}
                      <SignInToRespond>Sign in</SignInToRespond> to edit your
                      answer later.
                    </p>
                  </Show>
                  <RespondFooter />
                </Show>
              </Show>
            )}
          </Show>
        </main>
      </Layer>
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
