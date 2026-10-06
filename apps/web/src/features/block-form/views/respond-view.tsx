import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import CalendarCheck from '@phosphor/calendar-check.svg';
import PaperPlaneTilt from '@phosphor/paper-plane-tilt.svg';
import Spinner from '@phosphor/spinner.svg';
import { Button, cn } from '@ui';
import {
  createMemo,
  createUniqueId,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { fieldId, QuestionField } from '../components/respond/question-field';
import {
  ClosedNotice,
  Confirmation,
  ProgressStrip,
  RespondTitleCard,
  SectionHeading,
  StopScreen,
} from '../components/respond/respond-screens';
import { useFormContext } from '../context/form-context';
import { questionNumbers } from '../core/form-layout';
import type { FormCellValue, FormDetail } from '../core/form-model';
import { formAvailability, shortDate } from '../core/form-status';
import { resolvedWidget } from '../core/question-types';
import { createRespond } from '../primitives/create-respond';
import { BookingStepView } from './booking-step-view';

/**
 * The respond page (RFC 02 §4), shared by the app split, the public route
 * and the inline card (`compact`). One section per screen; nothing is sent
 * until Submit; a gate can stop on Next and the server has the last word.
 */
export function RespondView(props: {
  detail: FormDetail;
  compact: boolean;
  /** Author preview: answers and selected files stay in this tab. */
  preview?: boolean;
  /** Who is answering, as the page's own header says it. */
  header?: JSX.Element;
  /** Where the page scrolls, to bring each new section to the top. */
  scrollContainer?: () => HTMLElement | undefined;
  /** Read the form again; resolves whether the read succeeded. */
  refetch: () => Promise<boolean>;
}) {
  const context = useFormContext();
  // One per mount: a form can show as a page and a card at once.
  const scope = createUniqueId();
  const signedIn = () => !!context.viewer.userId();
  const mine = context.responses.createMine(() =>
    props.preview ? undefined : props.detail.form.id
  );
  const respond = createRespond({
    detail: () => props.detail,
    preview: props.preview,
    mine: () => (signedIn() ? mine.response() : null),
    mineFailed: () => signedIn() && !!mine.failure(),
    reloadMine: mine.refetch,
    refetch: async () => {
      await props.refetch();
    },
    signedIn,
    submit: (answers) =>
      context.responses.submit(props.detail.form.id, answers),
    editMine: (answers) =>
      context.responses.editMine(props.detail.form.id, answers),
    now: () => new Date(),
  });
  let root: HTMLDivElement | undefined;

  const form = () => props.detail.form;
  const isPublic = () => form().audience === 'public';
  const numbers = createMemo(() => questionNumbers(props.detail.layout));

  const open = () =>
    formAvailability(form(), props.detail.tableGone, new Date()).kind ===
    'open';
  const editNote = () => {
    if (props.preview || !signedIn() || !open()) return undefined;
    const closesAt = form().closesAt;
    return closesAt
      ? `You can edit your response until the form closes on ${shortDate(new Date(closesAt), new Date())}.`
      : 'You can edit your response while the form is open.';
  };

  function revealTop() {
    queueMicrotask(() => {
      const container = props.scrollContainer?.();
      if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
      else root?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  /** Bring the first refused question into view and focus it. */
  function revealProblem() {
    queueMicrotask(() => {
      const first = Object.keys(respond.problems())[0];
      if (!first) return;
      const field = document.getElementById(fieldId(scope, first));
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field?.focus({ preventScroll: true });
    });
  }

  async function submitAndReveal() {
    await respond.submit();
    revealProblem();
    if (respond.view().kind !== 'answering') revealTop();
  }

  /** From the update notice: read the form again, then back to the answers. */
  async function retry() {
    const read = await props.refetch().catch(() => false);
    if (!read) {
      context.notify.failure(
        'The form couldn’t be read again. Try again in a moment.'
      );
      return;
    }
    respond.checkAnswers();
  }

  const previewFiles = new Set<string>();
  onCleanup(() => {
    for (const url of previewFiles) URL.revokeObjectURL(url);
  });
  const upload = async (file: File) => {
    if (props.preview) {
      const url = URL.createObjectURL(file);
      previewFiles.add(url);
      return url;
    }
    const finished = respond.beginUpload();
    const uploaded = await context.uploadFile(file);
    finished();
    if (uploaded.isOk()) return uploaded.value;
    context.notify.failure(
      `The file couldn’t be uploaded: ${uploaded.error.message}`
    );
    return undefined;
  };

  const receipt = (answers: Record<string, FormCellValue>) =>
    props.detail.layout.sections.flatMap((section) =>
      section.questions.flatMap((question) => {
        const column = respond.columns().get(question.columnId);
        return column
          ? [
              {
                question,
                column,
                widget: resolvedWidget(column.kind, question.widget),
                value: answers[question.id],
              },
            ]
          : [];
      })
    );

  return (
    <div
      ref={root}
      class={cn(
        'mx-auto flex w-full flex-col',
        props.compact ? 'gap-3' : 'max-w-[680px] gap-4 px-4 pt-6 pb-28 sm:pb-10'
      )}
      data-form-respond={form().id}
    >
      <Show when={props.header}>{props.header}</Show>
      <Show when={!props.compact}>
        <RespondTitleCard
          name={form().name}
          description={form().description}
          compact={false}
        />
      </Show>
      <Switch>
        <Match
          when={(() => {
            const view = respond.view();
            return view.kind === 'preview-complete' ? view : undefined;
          })()}
        >
          {(completed) => (
            <Confirmation
              message={form().confirmationMessage || 'Preview complete.'}
              fresh
              submittedAt={undefined}
              receipt={receipt(completed().answers)}
              canEdit={false}
              compact={props.compact}
              renderEntityLabel={context.ui.renderEntityLabel}
              onEdit={respond.restartPreview}
              notice={
                <p class="text-sm text-ink-muted">
                  Preview complete. No response was saved.
                </p>
              }
              footer={
                <Button
                  variant="outline"
                  class="self-start"
                  onClick={() => {
                    respond.restartPreview();
                    revealTop();
                  }}
                >
                  Try again
                </Button>
              }
            />
          )}
        </Match>
        <Match
          when={(() => {
            const view = respond.view();
            return view.kind === 'booking' ? view : undefined;
          })()}
        >
          {(step) => (
            <>
              <BookingStepView
                booking={step().booking}
                preview={step().preview}
              />
              <Show when={step().preview}>
                <Button
                  variant="outline"
                  class="self-start"
                  onClick={() => {
                    respond.restartPreview();
                    revealTop();
                  }}
                >
                  Try again
                </Button>
              </Show>
            </>
          )}
        </Match>
        <Match when={respond.view().kind === 'loading'}>
          <div
            class="flex flex-col gap-3"
            aria-busy="true"
            aria-label="Loading"
          >
            <div class="h-24 animate-pulse rounded-xl bg-hover" />
            <div class="h-24 animate-pulse rounded-xl bg-hover" />
          </div>
        </Match>
        <Match
          when={(() => {
            const view = respond.view();
            return view.kind === 'closed' ? view : undefined;
          })()}
        >
          {(closed) => <ClosedNotice reason={closed().reason} />}
        </Match>
        <Match when={respond.view().kind === 'updating'}>
          <div
            role="status"
            class="flex flex-col gap-1 rounded-xl border border-edge bg-surface p-5"
          >
            <p class="text-sm font-medium text-ink">
              This form is being updated
            </p>
            <p class="text-sm text-ink-muted">
              Nothing you entered was submitted. Try again in a moment.
            </p>
            <Button
              variant="outline"
              size="sm"
              class="mt-2 self-start"
              onClick={() => void retry()}
            >
              Try again
            </Button>
          </div>
        </Match>
        <Match
          when={(() => {
            const view = respond.view();
            return view.kind === 'stopped' ? view : undefined;
          })()}
        >
          {(stopped) => (
            <StopScreen
              message={stopped().message}
              editing={respond.editing()}
              onCheckAnswers={() => {
                respond.checkAnswers();
                revealTop();
              }}
              onMessageOwner={
                signedIn() && context.viewer.userId() !== form().ownerId
                  ? () =>
                      void context
                        .messageOwner(form().ownerId)
                        .mapErr((failure) =>
                          context.notify.failure(
                            `The conversation couldn’t be opened: ${failure.message}`
                          )
                        )
                  : undefined
              }
            />
          )}
        </Match>
        <Match
          when={(() => {
            const view = respond.view();
            return view.kind === 'confirmation' ? view : undefined;
          })()}
        >
          {(confirmation) => (
            <Confirmation
              message={form().confirmationMessage}
              fresh={confirmation().fresh}
              submittedAt={confirmation().submittedAt}
              receipt={receipt(confirmation().answers)}
              canEdit={confirmation().canEdit}
              compact={props.compact}
              renderEntityLabel={context.ui.renderEntityLabel}
              onEdit={() => {
                respond.editResponse();
                revealTop();
              }}
              notice={
                <>
                  <Show when={!confirmation().fresh && !open()}>
                    <p class="text-xs text-ink">
                      This form is closed, so your response can’t be changed.
                    </p>
                  </Show>
                  <Show when={confirmation().alreadyResponded}>
                    <p class="text-xs text-ink">
                      You had already responded, so the answers you just gave
                      weren’t sent. This is your saved response.
                    </p>
                  </Show>
                </>
              }
              footer={
                <>
                  <Show when={confirmation().booking}>
                    <Button
                      variant="cta"
                      class="self-start"
                      onClick={() => {
                        respond.openBooking();
                        revealTop();
                      }}
                    >
                      <CalendarCheck class="size-3.5" />
                      Book a time
                    </Button>
                  </Show>
                  <p class="px-1 text-xs text-ink-muted">
                    Stored as a row in a database the form owner controls. Your
                    answers are visible to the form’s editors.
                  </p>
                </>
              }
            />
          )}
        </Match>
        <Match
          when={(() => {
            const view = respond.view();
            return view.kind === 'answering' ? view : undefined;
          })()}
        >
          {(answering) => (
            <form
              class="flex flex-col gap-3"
              noValidate
              aria-label={answering().section.title || form().name}
              onSubmit={(event) => {
                event.preventDefault();
                if (answering().isLast) {
                  void submitAndReveal();
                  return;
                }
                if (respond.next()) revealTop();
                else revealProblem();
              }}
            >
              <Show when={answering().total > 1}>
                <ProgressStrip
                  position={answering().position}
                  total={answering().total}
                />
              </Show>
              <SectionHeading
                title={answering().section.title}
                description={answering().section.description}
              />
              <For each={answering().section.questions}>
                {(question) => {
                  const column = () => respond.columns().get(question.columnId);
                  return (
                    <Show when={column()}>
                      {(columnFacts) => {
                        const widget = () =>
                          resolvedWidget(columnFacts().kind, question.widget);
                        // Files and Macro pickers need an account; an
                        // anonymous visitor is told so, not shown a dead end.
                        const needsSignIn = () => {
                          if (signedIn()) return undefined;
                          if (widget() === 'file' && isPublic())
                            return 'asks for a file';
                          const kind = columnFacts().kind.type;
                          return kind === 'entity' || kind === 'relation'
                            ? 'picks from Macro'
                            : undefined;
                        };
                        return (
                          <Show
                            when={!needsSignIn()}
                            fallback={
                              <div class="rounded-xl border border-edge bg-surface px-4 py-3 text-sm text-ink-muted">
                                <p>
                                  “{columnFacts().name}” {needsSignIn()}, which
                                  needs you to sign in.
                                </p>
                                <Show when={respond.problems()[question.id]}>
                                  {(problem) => (
                                    <p
                                      id={`${fieldId(scope, question.id)}-error`}
                                      class="mt-1 text-xs text-failure-ink"
                                    >
                                      {problem()}
                                    </p>
                                  )}
                                </Show>
                              </div>
                            }
                          >
                            <QuestionField
                              scope={scope}
                              question={question}
                              column={columnFacts()}
                              widget={widget()}
                              number={numbers().get(question.id) ?? 0}
                              value={respond.answers()[question.id]}
                              problem={respond.problems()[question.id]}
                              disabled={answering().submitting}
                              compact={props.compact}
                              upload={upload}
                              onChange={(value) =>
                                respond.setAnswer(question.id, value)
                              }
                              renderEntityPicker={(picker) =>
                                context.ui.renderEntityPicker({
                                  ...picker,
                                  label: columnFacts().name,
                                  value: respond.answers()[question.id],
                                  onChange: (value) =>
                                    respond.setAnswer(question.id, value),
                                })
                              }
                              renderRelationPicker={(picker) =>
                                context.ui.renderRelationPicker({
                                  ...picker,
                                  label: columnFacts().name,
                                  value: respond.answers()[question.id],
                                  onChange: (value) =>
                                    respond.setAnswer(question.id, value),
                                })
                              }
                            />
                          </Show>
                        );
                      }}
                    </Show>
                  );
                }}
              </For>
              <Show
                when={
                  answering().section.questions.some(
                    (question) => question.required
                  ) || editNote()
                }
              >
                <div
                  role="note"
                  aria-label="Form guidance"
                  class="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-xs text-ink-muted"
                >
                  <Show
                    when={answering().section.questions.some(
                      (question) => question.required
                    )}
                  >
                    <p class="inline-flex items-center gap-1.5">
                      <span class="text-failure-ink" aria-hidden="true">
                        *
                      </span>
                      <span>Required fields</span>
                    </p>
                  </Show>
                  <Show when={editNote()}>{(note) => <p>{note()}</p>}</Show>
                </div>
              </Show>
              <Show when={respond.failure()}>
                {(message) => (
                  <p role="alert" class="px-1 text-sm text-failure-ink">
                    {message()}
                  </p>
                )}
              </Show>
              <div
                class={cn(
                  'flex items-center justify-between gap-2',
                  !props.compact &&
                    'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 touch:max-sm:bottom-[var(--mobile-content-inset-bottom,0px)] max-sm:z-10 max-sm:border-t max-sm:border-edge max-sm:bg-surface max-sm:px-4 max-sm:py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]'
                )}
              >
                <Show when={!answering().isFirst} fallback={<span />}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    disabled={answering().submitting}
                    onClick={() => {
                      respond.back();
                      revealTop();
                    }}
                  >
                    <ArrowLeft class="size-3.5" />
                    Back
                  </Button>
                </Show>
                <Button
                  type="submit"
                  variant="cta"
                  size="md"
                  disabled={answering().submitting || answering().uploading}
                  aria-busy={answering().submitting}
                >
                  <Show
                    when={!answering().uploading}
                    fallback={<>Waiting for upload…</>}
                  >
                    <Show
                      when={answering().isLast}
                      fallback={
                        <>
                          Next
                          <ArrowRight class="size-3.5" />
                        </>
                      }
                    >
                      <Show
                        when={answering().submitting}
                        fallback={<PaperPlaneTilt class="size-3.5" />}
                      >
                        <Spinner class="size-3.5 animate-spin" />
                      </Show>
                      {respond.editing()
                        ? 'Update response'
                        : answering().continuesToBooking
                          ? 'Continue to booking'
                          : 'Submit'}
                    </Show>
                  </Show>
                </Button>
              </div>
            </form>
          )}
        </Match>
      </Switch>
    </div>
  );
}
