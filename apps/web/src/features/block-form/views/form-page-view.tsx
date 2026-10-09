import { Button } from '@ui';
import {
  type Component,
  createUniqueId,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { type FormTab, FormTabs } from '../components/form-tabs';
import {
  type FormDetailSource,
  type FormLoadFailure,
  useFormContext,
} from '../context/form-context';
import type { FormDetail } from '../core/form-model';
import type { Preview } from '../primitives/create-preview';
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

export type FormHeaderProps = { tabs: JSX.Element };

function InlineFormHeader(props: FormHeaderProps) {
  return (
    <div class="flex items-center justify-between gap-3 px-4 py-2">
      {props.tabs}
    </div>
  );
}

/** The tab strip, with the response count only editors can read. */
function EditorTabs(props: {
  detail: FormDetail;
  tab: FormTab;
  idPrefix: string;
  header?: Component<FormHeaderProps>;
  onTabChange: (tab: FormTab) => void;
}) {
  const context = useFormContext();
  const summary = context.responses.createSummary(
    () => props.detail.form.id,
    () => props.detail.access !== 'view'
  );
  return (
    <Dynamic
      component={props.header ?? InlineFormHeader}
      tabs={
        <FormTabs
          tab={props.tab}
          idPrefix={props.idPrefix}
          responsesCount={summary.value()?.submitted}
          onChange={props.onTabChange}
        />
      }
    />
  );
}

/**
 * The form page: editors get Build, Responses and Share; viewers land on the respond page.
 */
type FormPageProps = {
  source: FormDetailSource;
  /** Host placement for navigation. */
  header?: Component<FormHeaderProps>;
  tab: FormTab;
  respondLink: string;
  /** What a preview waits for before it reads the form. */
  preview: Pick<Preview, 'trackWrites' | 'trackLayout'>;
  onTabChange: (tab: FormTab) => void;
  onOpenDatabase: (databaseId: string) => void;
  onOpenShare: () => void;
  onTrashed: () => void;
};

/**
 * An editor's tabs. The shared layout stays open across them, so edits keep
 * syncing and a preview publishes them from any tab.
 */
function EditorPanels(
  props: FormPageProps & { detail: FormDetail; tabsId: string }
) {
  const context = useFormContext();
  const collaboration = context.createLayoutCollaboration(props.detail.form.id);
  props.preview.trackLayout(collaboration.flush);
  // Authoring state and pending writes belong to the editor, across tab changes.
  const builder = (
    <BuilderView
      source={props.source}
      detail={props.detail}
      collaboration={collaboration}
      active={props.tab === 'build'}
      trackWrites={props.preview.trackWrites}
      onOpenDatabase={props.onOpenDatabase}
    />
  );
  const sharing = (
    <ShareTabView
      detail={props.detail}
      respondLink={props.respondLink}
      trackWrites={props.preview.trackWrites}
      onOpenShare={props.onOpenShare}
      onTrashed={props.onTrashed}
    />
  );
  return (
    <>
      <EditorTabs
        header={props.header}
        detail={props.detail}
        idPrefix={props.tabsId}
        tab={props.tab}
        onTabChange={props.onTabChange}
      />
      <div
        id={`${props.tabsId}-panel-${props.tab}`}
        role="tabpanel"
        aria-labelledby={`${props.tabsId}-tab-${props.tab}`}
        class="min-h-0 flex-1"
      >
        <Switch>
          <Match when={props.tab === 'build'}>{builder}</Match>
          <Match when={props.tab === 'responses'}>
            <ResponsesView detail={props.detail} />
          </Match>
          <Match when={props.tab === 'share'}>{sharing}</Match>
        </Switch>
      </div>
    </>
  );
}

export function FormPageView(props: FormPageProps) {
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
            <EditorPanels {...props} detail={detail()} tabsId={tabsId} />
          </Show>
        )}
      </Show>
    </div>
  );
}
