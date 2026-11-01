import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type {
  EnrollmentAction,
  EnrollmentSummary,
  SequenceStatus,
} from '@service-email/generated/schemas';
import { Button, ConfirmDialog, EmptyStatePanel } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { EnrollmentRow, EnrollmentSteps } from '../components/enrollment-row';
import { failureMessage } from '../components/failure-message';
import { useSequences } from '../context/sequences-context';
import { enrollmentActions, isRetry, shownStatus } from '../core/sequence';

const SURFACE = 'sequences.enrollments';

/** Fetched when its row opens, so the list stays a page of summaries. */
function EnrollmentStepsView(props: { enrollmentId: string }) {
  const source = useSequences().createEnrollment(() => props.enrollmentId);
  return (
    <Switch>
      <Match when={source.detail()}>
        {(detail) => <EnrollmentSteps steps={detail().steps} />}
      </Match>
      <Match when={source.failed()}>
        <div class="flex items-center gap-2 text-xs text-failure" role="alert">
          {t('sequences.stepsLoadFailed')}
          <Button
            type="button"
            variant="link"
            size="xs"
            onClick={() => fireAndForget(source.refresh(), SURFACE)}
          >
            {t('sequences.retry')}
          </Button>
        </div>
      </Match>
      <Match when={source.pending()}>
        <ListSkeleton.Root label={t('sequences.loadingSteps')}>
          <ListSkeleton.Row>
            <ListSkeleton.Bar class="h-3 w-2/3" />
          </ListSkeleton.Row>
        </ListSkeleton.Root>
      </Match>
    </Switch>
  );
}

export function EnrollmentsView(props: {
  sequenceId: string;
  sequenceStatus: SequenceStatus;
  enrollments: readonly EnrollmentSummary[];
  onEnroll?: () => void;
  onOpenContact: (contactId: string) => void;
}) {
  const context = useSequences();
  const commands = context.createEnrollmentCommands(() => props.sequenceId);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const [unsubscribing, setUnsubscribing] = createSignal<EnrollmentSummary>();
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  async function run(enrollment: EnrollmentSummary, action: EnrollmentAction) {
    const result = await commands.run(enrollment, action);
    if (result.isErr()) context.feedback.failure(failureMessage(result.error));
    return result.isOk();
  }
  const unsubscribePending = () => {
    const enrollment = unsubscribing();
    return !!enrollment && commands.pending(enrollment.id);
  };
  async function unsubscribe(enrollment: EnrollmentSummary) {
    if (await run(enrollment, 'unsubscribe'))
      context.feedback.success(t('sequences.unsubscribed'));
    setUnsubscribing(undefined);
  }
  return (
    <div class="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h3 class="text-base font-medium">{t('sequences.people')}</h3>
        <p class="mt-1 text-xs text-ink-muted">{t('sequences.peopleHint')}</p>
      </div>
      <Show
        when={props.enrollments.length}
        fallback={
          <EmptyStatePanel
            centered
            class="h-auto py-10"
            title={t('sequences.noEnrollments')}
            description={
              props.onEnroll
                ? t('sequences.noEnrollmentsHint')
                : t('sequences.activateToEnroll')
            }
            primaryAction={
              props.onEnroll
                ? {
                    label: t('sequences.enrollPeople'),
                    onClick: props.onEnroll,
                  }
                : undefined
            }
          />
        }
      >
        <For each={props.enrollments}>
          {(enrollment) => (
            <EnrollmentRow
              enrollment={enrollment}
              status={shownStatus(
                enrollment,
                props.sequenceStatus === 'paused'
              )}
              actions={enrollmentActions(enrollment, props.sequenceStatus)}
              retry={isRetry(enrollment)}
              busy={commands.pending(enrollment.id)}
              expanded={expanded().has(enrollment.id)}
              onToggle={() => toggle(enrollment.id)}
              onAction={(action) =>
                action === 'unsubscribe'
                  ? setUnsubscribing(enrollment)
                  : fireAndForget(run(enrollment, action), SURFACE)
              }
              onOpenContact={
                enrollment.crmContactId
                  ? () => props.onOpenContact(enrollment.crmContactId!)
                  : undefined
              }
            >
              <EnrollmentStepsView enrollmentId={enrollment.id} />
            </EnrollmentRow>
          )}
        </For>
      </Show>
      <ConfirmDialog
        open={!!unsubscribing()}
        onOpenChange={(open) => {
          if (!open) setUnsubscribing(undefined);
        }}
        pending={unsubscribePending()}
        tone="danger"
        title={
          <span class="ph-no-capture">
            {t('sequences.unsubscribeTitle', {
              email: unsubscribing()?.email ?? '',
            })}
          </span>
        }
        body={t('sequences.unsubscribeBody')}
        confirmLabel={t('sequences.unsubscribe')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          const enrollment = unsubscribing();
          if (enrollment) fireAndForget(unsubscribe(enrollment), SURFACE);
        }}
      />
    </div>
  );
}
