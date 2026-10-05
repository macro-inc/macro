import { Button } from '@ui';
import { createUniqueId, Match, Show, Switch } from 'solid-js';
import { type FormTab, FormTabs } from '../components/form-tabs';
import {
  type FormDetailSource,
  type FormLoadFailure,
  useFormContext,
} from '../context/form-context';
import type { FormDetail } from '../core/form-model';
import { availabilityLine, formAvailability } from '../core/form-status';
import { BuilderView } from './builder-view';
import { RespondView } from './respond-view';
import { ResponsesView } from './responses-view';
import { ShareTabView } from './share-tab-view';

export function FormLoadFailureView(props: {
  failure: FormLoadFailure;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <Switch>
        <Match when={props.failure.kind === 'not-found'}>
          <p class="font-medium text-ink">This form doesn’t exist</p>
          <p class="max-w-md text-sm text-ink-muted">
            It may have been deleted, or the link is wrong.
          </p>
        </Match>
        <Match when={props.failure.kind === 'sign-in'}>
          <p class="font-medium text-ink">Sign in to respond</p>
          <p class="max-w-md text-sm text-ink-muted">
            This form takes responses from Macro workspace members.
          </p>
        </Match>
        <Match when={props.failure.kind === 'forbidden'}>
          <p class="font-medium text-ink">You don’t have access to this form</p>
          <p class="max-w-md text-sm text-ink-muted">
            Ask its owner to share it with you.
          </p>
        </Match>
        <Match when={props.failure.kind === 'failed'}>
          <p class="font-medium text-ink">This form couldn’t be opened</p>
          <Button variant="outline" onClick={props.onRetry}>
            Try again
          </Button>
        </Match>
      </Switch>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div
      class="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-4 py-6"
      aria-busy="true"
      aria-label="Loading form"
    >
      <div class="h-32 animate-pulse rounded-xl bg-hover" />
      <div class="h-48 animate-pulse rounded-xl bg-hover" />
      <div class="h-24 animate-pulse rounded-xl bg-hover" />
    </div>
  );
}

/** The tab strip, with the response count only editors can read. */
function EditorTabs(props: {
  detail: FormDetail;
  tab: FormTab;
  idPrefix: string;
  onTabChange: (tab: FormTab) => void;
}) {
  const context = useFormContext();
  const summary = context.responses.createSummary(
    () => props.detail.form.id,
    () => props.detail.access !== 'view'
  );
  return (
    <FormTabs
      tab={props.tab}
      idPrefix={props.idPrefix}
      responsesCount={summary.value()?.submitted}
      onChange={props.onTabChange}
      status={availabilityLine(
        formAvailability(props.detail.form, props.detail.tableGone, new Date()),
        new Date()
      )}
    />
  );
}

/**
 * The form page (RFC 02 §2): editors get Build, Responses and Share with the
 * status at the right; viewers land on the respond page.
 */
export function FormPageView(props: {
  source: FormDetailSource;
  tab: FormTab;
  respondLink: string;
  onTabChange: (tab: FormTab) => void;
  onOpenDatabase: (databaseId: string) => void;
  onOpenShare: () => void;
  onTrashed: () => void;
}) {
  let respondScroll: HTMLDivElement | undefined;
  // One per mount: the same form can be open in two splits.
  const tabsId = createUniqueId();
  return (
    <div class="flex size-full min-h-0 flex-col bg-canvas-base text-ink touch:pt-(--mobile-content-inset-top)">
      <Show
        when={props.source.detail()}
        fallback={
          <Show when={props.source.failure()} fallback={<FormSkeleton />}>
            {(failure) => (
              <FormLoadFailureView
                failure={failure()}
                onRetry={() => void props.source.refetch()}
              />
            )}
          </Show>
        }
      >
        {(detail) => (
          <Show
            when={detail().access !== 'view'}
            fallback={
              <div
                ref={respondScroll}
                class="h-full min-h-0 overflow-y-auto touch:pb-(--mobile-content-inset-bottom)"
              >
                <RespondView
                  detail={detail()}
                  refetch={props.source.refetch}
                  compact={false}
                  scrollContainer={() => respondScroll}
                />
              </div>
            }
          >
            <EditorTabs
              detail={detail()}
              idPrefix={tabsId}
              tab={props.tab}
              onTabChange={props.onTabChange}
            />
            <div
              id={`${tabsId}-panel-${props.tab}`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-tab-${props.tab}`}
              class="min-h-0 flex-1"
            >
              <Switch>
                <Match when={props.tab === 'build'}>
                  <BuilderView
                    source={props.source}
                    detail={detail()}
                    onOpenResponses={() => props.onTabChange('responses')}
                    onOpenDatabase={props.onOpenDatabase}
                  />
                </Match>
                <Match when={props.tab === 'responses'}>
                  <ResponsesView
                    detail={detail()}
                    onOpenDatabase={props.onOpenDatabase}
                  />
                </Match>
                <Match when={props.tab === 'share'}>
                  <ShareTabView
                    detail={detail()}
                    respondLink={props.respondLink}
                    onOpenShare={props.onOpenShare}
                    onTrashed={props.onTrashed}
                  />
                </Match>
              </Switch>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}
