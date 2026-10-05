import Database from '@phosphor/database.svg';
import { Button } from '@ui';
import { createUniqueId, For, Match, Show, Switch } from 'solid-js';
import { type FormTab, FormTabs } from '../components/form-tabs';
import { QuestionTypeIcon } from '../components/question-type-icon';
import {
  type FormDetailSource,
  type FormLoadFailure,
  useFormContext,
} from '../context/form-context';
import type { FormDetail, FormSection } from '../core/form-model';
import { availabilityLine, formAvailability } from '../core/form-status';
import { questionTypeLabel, questionTypeOf } from '../core/question-types';
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

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

/** Sections are numbered among sections, gates among gates. */
function sectionLabel(detail: FormDetail, section: FormSection): string {
  const peers = detail.layout.sections.filter(
    (peer) => peer.kind === section.kind
  );
  const position = peers.findIndex((peer) => peer.id === section.id) + 1;
  return section.kind === 'gate'
    ? `Gate ${position}`
    : `Section ${position} of ${peers.length}`;
}

/** The form's sections and questions, read-only. */
function FormSummary(props: { detail: FormDetail }) {
  const sections = () => props.detail.layout.sections;
  const questionCount = () =>
    sections().reduce((count, section) => count + section.questions.length, 0);
  const gateCount = () =>
    sections().filter((section) => section.kind === 'gate').length;
  const column = (columnId: string) =>
    props.detail.columns.find((entry) => entry.id === columnId);
  return (
    <div class="h-full min-h-0 overflow-y-auto touch:pb-(--mobile-content-inset-bottom)">
      <div class="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-4 py-6">
        <div class="flex flex-col gap-1 rounded-xl border border-edge bg-surface p-4">
          <h2 class="text-lg font-semibold text-ink">
            {props.detail.form.name}
          </h2>
          <Show when={props.detail.form.description}>
            <p class="text-sm text-ink-muted">
              {props.detail.form.description}
            </p>
          </Show>
          <p class="text-xs text-ink-muted">
            {[
              plural(sections().length - gateCount(), 'section'),
              plural(questionCount(), 'question'),
              ...(gateCount() > 0 ? [plural(gateCount(), 'gate')] : []),
            ].join(' · ')}
          </p>
        </div>
        <For each={sections()}>
          {(section) => (
            <section
              aria-label={`${sectionLabel(props.detail, section)}: ${section.title}`}
              class="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4"
            >
              <span class="text-xs font-medium text-ink-muted">
                {sectionLabel(props.detail, section)}
              </span>
              <h3 class="text-sm font-semibold text-ink">{section.title}</h3>
              <Show when={section.description}>
                <p class="text-sm text-ink-muted">{section.description}</p>
              </Show>
              <Show when={section.kind === 'gate' && section.gateMessage}>
                <p class="text-sm text-ink-muted">
                  Respondents who don’t pass see: {section.gateMessage}
                </p>
              </Show>
              <Show when={section.questions.length > 0}>
                <ul class="flex flex-col divide-y divide-edge-divider">
                  <For each={section.questions}>
                    {(question) => (
                      <Show when={column(question.columnId)}>
                        {(asked) => (
                          <li class="flex items-start gap-2 py-2">
                            <QuestionTypeIcon
                              type={questionTypeOf(
                                asked().kind,
                                question.widget
                              )}
                              class="mt-0.5 size-4 shrink-0 text-ink-muted"
                            />
                            <div class="flex min-w-0 flex-1 flex-col">
                              <span class="text-sm text-ink">
                                {asked().name}
                                <Show when={question.required}>
                                  <span
                                    class="text-failure"
                                    aria-label="required"
                                  >
                                    *
                                  </span>
                                </Show>
                              </span>
                              <Show when={question.helpText}>
                                <span class="text-xs text-ink-muted">
                                  {question.helpText}
                                </span>
                              </Show>
                            </div>
                            <span class="shrink-0 rounded bg-active px-1.5 text-xs text-ink-muted">
                              {questionTypeLabel(asked().kind, question.widget)}
                            </span>
                          </li>
                        )}
                      </Show>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
          )}
        </For>
      </div>
    </div>
  );
}

/** How many responded, from the summary only editors can read. */
function ResponseCounts(props: {
  detail: FormDetail;
  onOpenDatabase: (databaseId: string) => void;
}) {
  const context = useFormContext();
  const summary = context.responses.createSummary(
    () => props.detail.form.id,
    () => true
  );
  const sectionTitle = (sectionId: string) =>
    props.detail.layout.sections.find((section) => section.id === sectionId)
      ?.title ?? 'a gate';
  return (
    <div class="h-full min-h-0 overflow-y-auto touch:pb-(--mobile-content-inset-bottom)">
      <div class="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-4 py-6">
        <Show
          when={summary.value()}
          fallback={
            <Show
              when={summary.failure()}
              fallback={<div class="h-24 animate-pulse rounded-xl bg-hover" />}
            >
              <p role="alert" class="text-sm text-ink-muted">
                The response counts couldn’t be read.
              </p>
            </Show>
          }
        >
          {(counts) => (
            <ul
              aria-label="Response counts"
              class="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3"
            >
              <li class="flex flex-col rounded-xl border border-edge bg-surface p-4">
                <span class="text-2xl font-semibold text-ink tabular-nums">
                  {counts().submitted}
                </span>
                <span class="text-xs text-ink-muted">Submitted</span>
              </li>
              <For each={counts().stoppedBySection}>
                {(stop) => (
                  <li class="flex flex-col rounded-xl border border-edge bg-surface p-4">
                    <span class="text-2xl font-semibold text-ink tabular-nums">
                      {stop.count}
                    </span>
                    <span class="text-xs text-ink-muted">
                      Stopped at {sectionTitle(stop.sectionId)}
                    </span>
                  </li>
                )}
              </For>
              <li class="flex flex-col rounded-xl border border-edge bg-surface p-4">
                <span class="text-2xl font-semibold text-ink tabular-nums">
                  {counts().rows}
                </span>
                <span class="text-xs text-ink-muted">Rows in the table</span>
              </li>
            </ul>
          )}
        </Show>
        <p class="text-sm text-ink-muted">
          Every response is a row in the form’s database.
        </p>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => props.onOpenDatabase(props.detail.form.databaseId)}
          >
            <Database class="size-3.5" aria-hidden="true" />
            Open database
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The form page (RFC 02 §2): editors get Build, Responses and Share with the
 * status at the right; viewers see the questions. Build and Responses are
 * read-only summaries until the builder and the responses grid exist.
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
            fallback={<FormSummary detail={detail()} />}
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
                  <FormSummary detail={detail()} />
                </Match>
                <Match when={props.tab === 'responses'}>
                  <ResponseCounts
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
