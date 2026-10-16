import { CalendarDraftComposer } from '@core/component/AI/component/tool/calendar/DraftComposer';
import { EmailDraftComposer } from '@core/component/AI/component/tool/email/DraftComposer';
import type { UserToolReviewSink } from '@core/component/AI/component/tool/user-tool-review';
import {
  CreateCalendarEvent,
  SendEmail,
} from '@service-cognition/generated/tools/schemas';
import { Button } from '@ui/components/Button';
import { ConfirmDialog } from '@ui/components/ConfirmDialog';
import { createEffect, createSignal, Match, on, Show, Switch } from 'solid-js';
import { ReviewDeck } from '../components/review-deck';
import {
  ReviewNavigation,
  type ReviewSummary,
} from '../components/review-navigation';
import type { Review, ReviewActions, ReviewItem } from '../core/review';
import { createReviewController } from '../primitives/review-controller';
import { validateReviewDraft } from '../primitives/review-draft-validation';

/** Saved drafts reuse the same composers as chat, with a deck only for batches. */
export function ReviewStack(props: {
  review: Review;
  canAct: boolean;
  actions: ReviewActions;
}) {
  const controller = createReviewController(
    () => props.review,
    props.actions,
    validateReviewDraft
  );
  const [index, setIndex] = createSignal(0);
  const [generation, setGeneration] = createSignal(0);
  const [preparing, setPreparing] = createSignal(false);
  const [navigating, setNavigating] = createSignal(false);
  const [submittedBatch, setSubmittedBatch] = createSignal<string[]>();
  const [confirmingBatch, setConfirmingBatch] = createSignal<string[]>([]);
  const [confirmationOpen, setConfirmationOpen] = createSignal(false);
  const record = controller.record;
  const current = () => record().items[index()];
  const isBatch = () => record().items.length > 1;
  let readDraft: (() => unknown) | undefined;
  let readSubmit: (() => Promise<unknown | undefined>) | undefined;
  let section: HTMLElement | undefined;
  const working = () => controller.busy() || preparing() || navigating();
  const locked = () =>
    !props.canAct ||
    working() ||
    Boolean(controller.error()) ||
    controller.stale() ||
    record().presentedAt == null ||
    Boolean(record().notificationId) ||
    record().items.some((item) => item.status === 'submitting');

  function capture(): boolean {
    if (locked() || current()?.status !== 'pending') return true;
    const draft = readDraft?.();
    if (draft === undefined) return false;
    controller.edit(current().id, draft);
    return true;
  }
  function select(next: number) {
    if (next === index()) return;
    readDraft = undefined;
    readSubmit = undefined;
    setIndex(next);
  }
  // Submission acknowledges the batch before execution finishes. Poll updates
  // move focus once, after this component's submitted items have settled.
  createEffect(
    on([record, submittedBatch], ([review, submitted]) => {
      if (!submitted) return;
      const items = review.items.filter((item) => submitted.includes(item.id));
      if (items.some((item) => item.status === 'submitting')) return;
      setSubmittedBatch(undefined);
      const attention = review.items.findIndex(
        (item) =>
          submitted.includes(item.id) &&
          (item.status === 'unknown' ||
            (item.status === 'pending' && Boolean(item.error)))
      );
      if (attention >= 0) {
        select(attention);
        section?.focus({ preventScroll: true });
      }
    })
  );
  async function navigate(next: number) {
    if (
      working() ||
      next < 0 ||
      next >= record().items.length ||
      next === index()
    )
      return;
    if (!capture()) return;
    setNavigating(true);
    try {
      if (await controller.flush()) select(next);
    } finally {
      setNavigating(false);
    }
  }
  async function reload() {
    if (!(await controller.reload())) return;
    readDraft = undefined;
    readSubmit = undefined;
    setIndex(Math.min(index(), Math.max(0, record().items.length - 1)));
    setGeneration((value) => value + 1);
  }
  function showInvalidDraft() {
    const invalid = controller.validation();
    if (!invalid) return;
    const next = record().items.findIndex((item) => item.id === invalid.item);
    if (next >= 0) select(next);
  }
  async function submitAll(items: string[]) {
    if (locked() || pending() === 0) return;
    setPreparing(true);
    try {
      if (current()?.status === 'pending') {
        if (!readSubmit) return;
        const draft = await readSubmit();
        if (draft === undefined) return;
        controller.edit(current().id, draft);
      }
      if (!(await controller.decide('submit', items))) {
        showInvalidDraft();
      } else {
        setSubmittedBatch(items);
      }
    } finally {
      setPreparing(false);
    }
  }
  async function decideItem(action: 'submit' | 'dismiss', id: string) {
    const done = await controller.decide(action, [id]);
    if (!done) return false;
    const items = record().items;
    const next = items.findIndex(
      (item, position) => position > index() && item.status === 'pending'
    );
    const remaining =
      next >= 0
        ? next
        : items.findIndex(
            (item) => item.id !== id && item.status === 'pending'
          );
    if (remaining >= 0) {
      select(remaining);
      section?.focus({ preventScroll: true });
    }
    return true;
  }
  const sink = <T,>(id: string): UserToolReviewSink<T> => ({
    canAct: () =>
      !locked() &&
      record().items.find((item) => item.id === id)?.status === 'pending',
    lockedNotice: () =>
      !props.canAct
        ? 'Only the session owner can submit this review.'
        : undefined,
    onEdit: (draft) => {
      controller.edit(id, draft);
    },
    onExecute: async (draft) => {
      controller.edit(id, draft);
      return decideItem('submit', id);
    },
    onReject: () => decideItem('dismiss', id),
  });
  const pending = () =>
    record().items.filter((item) => item.status === 'pending').length;
  const completed = () =>
    record().items.filter((item) => item.status === 'completed').length;
  const dismissed = () =>
    record().items.filter((item) => item.status === 'dismissed').length;
  const needsAttention = () =>
    record().items.filter(
      (item) =>
        item.status === 'unknown' ||
        (item.status === 'pending' && Boolean(item.error))
    ).length;
  const progress = () =>
    [
      completed() > 0
        ? `${completed()} ${record().kind === 'email' ? 'sent' : record().kind === 'calendar' ? 'created' : 'answered'}`
        : '',
      dismissed() > 0 ? `${dismissed()} dismissed` : '',
      needsAttention() > 0
        ? `${needsAttention()} ${needsAttention() === 1 ? 'needs' : 'need'} attention`
        : '',
      pending() > 0 ? `${pending()} remaining` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  const mountKey = () => `${current()?.id}:${generation()}`;
  return (
    <section
      ref={section}
      tabIndex={-1}
      class="my-3 min-w-0"
      aria-label={record().title}
    >
      <Show when={isBatch()}>
        <ReviewNavigation
          title={record().title}
          items={record().items.map((item) =>
            reviewSummary(item, record().kind)
          )}
          index={index()}
          disabled={working()}
          onNavigate={navigate}
        />
        <span class="sr-only" role="status">
          Draft {index() + 1} of {record().items.length}
        </span>
      </Show>
      <Show when={record().presentedAt == null}>
        <p role="status" class="mb-2 text-xs text-ink-muted">
          Preparing saved review…
        </p>
      </Show>
      <Show when={controller.error()}>
        <p role="alert" class="mb-2 text-sm text-failure">
          {controller.error()}
        </p>
      </Show>
      <Show when={controller.stale() || controller.error()}>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={working()}
            onClick={() => void reload()}
          >
            Reload saved review
          </Button>
          <span class="text-xs text-ink-muted">
            Reloading replaces unsaved edits with the saved draft.
          </span>
        </div>
      </Show>
      <Show when={controller.validation()?.message}>
        <p role="alert" class="mb-2 text-sm text-failure">
          {controller.validation()?.message}
        </p>
      </Show>
      <Show when={current()?.error}>
        <p role="alert" class="mb-2 text-sm text-failure">
          {current()?.error}
        </p>
      </Show>
      <Show when={current()?.status !== 'pending'}>
        <p role="status" class="mb-2 px-1 text-xs text-ink-muted">
          {statusLabel(current()?.status, record().kind)}
        </p>
      </Show>
      <ReviewDeck
        count={record().items.length}
        email={record().kind === 'email'}
      >
        <Show when={mountKey()} keyed>
          {(_key) => {
            const item = current();
            if (!item) return null;
            const email = SendEmail.safeParse(item.draft);
            const calendar = CreateCalendarEvent.safeParse(item.draft);
            return (
              <Switch>
                <Match when={record().kind === 'email' && email.success}>
                  <EmailDraftComposer
                    initialData={email.success ? email.data : neverDraft()}
                    sink={sink(item.id)}
                    debugName={`review-${item.id}`}
                    readOnly={current()?.status !== 'pending'}
                    registerDraftReader={(reader) => {
                      readDraft = reader;
                    }}
                    registerSubmitReader={(reader) => {
                      readSubmit = reader;
                    }}
                  />
                </Match>
                <Match
                  when={
                    record().kind === 'calendar' &&
                    calendar.success &&
                    calendar.data.time !== undefined
                  }
                >
                  <CalendarDraftComposer
                    initialData={
                      calendar.success
                        ? { ...calendar.data, time: calendar.data.time }
                        : neverDraft()
                    }
                    sink={sink(item.id)}
                    previewKey={item.id}
                    registerDraftReader={(reader) => {
                      readDraft = reader;
                    }}
                    registerSubmitReader={(reader) => {
                      readSubmit = reader;
                    }}
                  />
                </Match>
                <Match when={!email.success && !calendar.success}>
                  <p role="alert">This draft cannot be displayed.</p>
                </Match>
              </Switch>
            );
          }}
        </Show>
      </ReviewDeck>
      <Show when={isBatch()}>
        <footer class="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
          <span class="min-w-0 text-xs text-ink-muted" role="status">
            {progress()}
          </span>
          <Show
            when={record().kind === 'email' || record().kind === 'calendar'}
          >
            <Button
              variant="strong"
              size="sm"
              class="ml-auto"
              disabled={locked() || pending() === 0}
              onClick={() => {
                setConfirmingBatch(
                  record()
                    .items.filter((item) => item.status === 'pending')
                    .map((item) => item.id)
                );
                setConfirmationOpen(true);
              }}
            >
              {record().kind === 'email' ? 'Send all' : 'Create all'} (
              {pending()})
            </Button>
          </Show>
        </footer>
        <ConfirmDialog
          open={confirmationOpen()}
          onOpenChange={setConfirmationOpen}
          title={`${record().kind === 'email' ? 'Send' : 'Create'} ${confirmingBatch().length} ${record().kind === 'email' ? 'email' : 'event'}${confirmingBatch().length === 1 ? '' : 's'}?`}
          body={
            record().kind === 'email'
              ? 'Each email will be sent to the recipients shown in its draft.'
              : 'These events will be created and guests will receive invitations.'
          }
          confirmLabel={`${record().kind === 'email' ? 'Send' : 'Create'} ${confirmingBatch().length} ${record().kind === 'email' ? 'email' : 'event'}${confirmingBatch().length === 1 ? '' : 's'}`}
          onConfirm={() => {
            const items = confirmingBatch();
            if (items.length === 0 || !confirmationOpen()) return;
            setConfirmationOpen(false);
            void submitAll(items);
          }}
        />
      </Show>
    </section>
  );
}
function neverDraft(): never {
  throw new Error('Invalid review draft');
}
function statusLabel(
  status: ReviewItem['status'] | undefined,
  kind: Review['kind']
): string {
  if (status === 'submitting')
    return kind === 'email' ? 'Sending…' : 'Creating…';
  if (status === 'completed') return kind === 'email' ? 'Sent' : 'Created';
  if (status === 'dismissed') return 'Dismissed';
  if (status === 'unknown')
    return 'Outcome unknown — check the destination before trying again.';
  return 'Draft';
}
function reviewSummary(item: ReviewItem, kind: Review['kind']): ReviewSummary {
  const summary = {
    id: item.id,
    title: 'Draft unavailable',
    description: '',
    status: item.error
      ? 'Needs attention'
      : item.status === 'unknown'
        ? 'Check status'
        : statusLabel(item.status, kind),
    needsAttention: Boolean(item.error) || item.status === 'unknown',
  };
  if (kind === 'email') {
    const email = SendEmail.safeParse(item.draft);
    if (!email.success) return summary;
    return {
      ...summary,
      title: email.data.subject || '(No subject)',
      description:
        email.data.to
          ?.map((recipient) =>
            recipient.name
              ? `${recipient.name} <${recipient.email}>`
              : recipient.email
          )
          .join(', ') || 'No recipients',
    };
  }
  if (kind === 'calendar') {
    const calendar = CreateCalendarEvent.safeParse(item.draft);
    if (!calendar.success) return summary;
    const time = calendar.data.time;
    const description =
      time.kind === 'allDay'
        ? `${time.startDate} · All day`
        : new Date(time.startsAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
          });
    return {
      ...summary,
      title: calendar.data.title || '(Untitled event)',
      description,
    };
  }
  return summary;
}
