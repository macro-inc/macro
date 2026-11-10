import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type {
  EnrollmentAction,
  EnrollmentSummary,
  SequenceStatus,
} from '@service-email/generated/schemas';
import { ConfirmDialog, EmptyStatePanel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { EnrollmentRow } from '../components/enrollment-row';
import { failureMessage } from '../components/failure';
import { useSequences } from '../context/sequences-context';
import { enrollmentActions, shownStatus } from '../core/sequence';

const SURFACE = 'sequences.enrollments';

export function EnrollmentsView(props: {
  sequenceId: string;
  sequenceStatus: SequenceStatus;
  stepCount: number;
  enrollments: readonly EnrollmentSummary[];
  onEnroll: () => void;
  onOpenContact: (contactId: string) => void;
}) {
  const context = useSequences();
  const commands = context.createEnrollmentCommands(() => props.sequenceId);
  const [unsubscribing, setUnsubscribing] = createSignal<EnrollmentSummary>();
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
      <Show
        when={props.enrollments.length}
        fallback={
          <EmptyStatePanel
            centered
            class="h-auto py-10"
            title={t('sequences.noEnrollments')}
            primaryAction={{
              label: t('sequences.addPeople'),
              onClick: props.onEnroll,
            }}
          />
        }
      >
        <For each={props.enrollments}>
          {(enrollment) => (
            <EnrollmentRow
              enrollment={enrollment}
              status={shownStatus(
                enrollment,
                props.sequenceStatus !== 'active'
              )}
              stepCount={props.stepCount}
              actions={enrollmentActions(enrollment, props.sequenceStatus)}
              busy={commands.pending(enrollment.id)}
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
            />
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
