import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import type { Sequence } from '@service-email/generated/schemas';
import { Button, DeleteDialog, Dropdown, EmptyStatePanel, Tabs } from '@ui';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { failureMessage } from '../components/failure-message';
import { SectionHeader } from '../components/section-header';
import { SequenceEditor } from '../components/sequence-editor';
import { SequenceStatusBadge } from '../components/status-badge';
import {
  type SequenceSource,
  useSequences,
} from '../context/sequences-context';
import { isRetryable } from '../core/errors';
import { isEditable } from '../core/sequence';
import { createSequenceDraft } from '../primitives/sequence-draft';
import { EnrollView } from './enroll';
import { EnrollmentsView } from './enrollments';

const SURFACE = 'sequences.detail';

type DetailTab = 'steps' | 'people';

function Notice(props: { children: JSX.Element; action?: JSX.Element }) {
  return (
    <div class="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-panel px-4 py-2 text-xs">
      {props.children}
      {props.action}
    </div>
  );
}

function SequenceDetailContent(props: {
  source: SequenceSource;
  sequence: Sequence;
  navigation?: JSX.Element;
  autofocusTitle?: boolean;
  onBack: () => void;
  onOpenContact: (contactId: string) => void;
}) {
  const context = useSequences();
  const senders = context.createSenders();
  const draft = createSequenceDraft(props.source);
  const [tab, setTab] = createSignal<DetailTab>('steps');
  const [enrolling, setEnrolling] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const status = () => props.sequence.status;
  const editable = () => isEditable(status());
  const busy = () => props.source.removing() || props.source.updating();
  const tabs = createMemo(() => [
    { value: 'steps' as const, label: t('sequences.steps') },
    {
      value: 'people' as const,
      label: t('sequences.people'),
      count: props.source.enrollments().length,
    },
  ]);
  const noSender = () =>
    !senders.pending() && !senders.senders().some((sender) => sender.ready);
  // Disconnecting its inbox clears the sender but leaves the sequence on.
  const senderDisconnected = () =>
    status() === 'active' && !props.sequence.linkId;

  async function setStatus(next: Sequence['status']) {
    if (!(await draft.save(next))) return;
    context.feedback.success(
      next === 'active'
        ? t('sequences.noticeActivated')
        : t('sequences.noticePaused')
    );
  }
  async function remove() {
    const result = await props.source.remove();
    setDeleting(false);
    if (result.isErr()) {
      context.feedback.failure(failureMessage(result.error));
      return;
    }
    context.feedback.success(t('sequences.noticeDeleted'));
    props.onBack();
  }
  const reload = () => {
    draft.discard();
    fireAndForget(props.source.refresh(), SURFACE);
  };
  const rename = (name: string) => {
    const current = draft.draft();
    if (current) draft.change({ ...current, name });
  };

  return (
    <>
      <SectionHeader
        title={
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            {props.navigation}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('sequences.allSequences')}
              tooltip={t('sequences.allSequences')}
              onClick={() => props.onBack()}
            >
              <ArrowLeftIcon class="size-4" aria-hidden="true" />
            </Button>
            <Show
              when={editable()}
              fallback={
                <h2 class="min-w-0 truncate px-1 text-sm font-semibold">
                  {props.sequence.name || t('sequences.untitled')}
                </h2>
              }
            >
              <span class="flex min-w-0 px-1">
                <InlineTitleEditor
                  value={draft.draft()?.name ?? props.sequence.name}
                  placeholder={t('sequences.untitled')}
                  ariaLabel={t('sequences.name')}
                  class="text-sm"
                  autofocus={props.autofocusTitle}
                  onRename={rename}
                />
              </span>
            </Show>
            <SequenceStatusBadge status={status()} />
            <Show when={draft.saving()}>
              <span class="text-xs text-ink-muted" role="status">
                {t('sequences.saving')}
              </span>
            </Show>
            <Tabs<DetailTab>
              aria-label={t('sequences.views')}
              value={tab()}
              onChange={setTab}
              options={tabs()}
            />
          </div>
        }
        actions={
          <>
            <Dropdown placement="bottom-end">
              <Dropdown.Trigger
                variant="ghost"
                size="icon-md"
                aria-label={t('sequences.actions')}
                tooltip={t('sequences.actions')}
                disabled={busy()}
              >
                <DotsThreeIcon class="size-4" aria-hidden="true" />
              </Dropdown.Trigger>
              <Dropdown.Content class="min-w-44">
                <Dropdown.Group>
                  <Dropdown.Item onSelect={() => setDeleting(true)}>
                    <TrashIcon class="size-4" aria-hidden="true" />
                    {t('common.delete')}
                  </Dropdown.Item>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
            <Show
              when={editable()}
              fallback={
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy()}
                    onClick={() => fireAndForget(setStatus('paused'), SURFACE)}
                  >
                    {t('sequences.pauseSequence')}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy()}
                    onClick={() => setEnrolling(true)}
                  >
                    {t('sequences.addPeople')}
                  </Button>
                </>
              }
            >
              <Button
                type="button"
                variant="primary"
                disabled={busy()}
                onClick={() => fireAndForget(setStatus('active'), SURFACE)}
              >
                {status() === 'paused'
                  ? t('sequences.resumeSequence')
                  : t('sequences.activate')}
              </Button>
            </Show>
          </>
        }
      />
      <Switch>
        <Match when={draft.conflict()}>
          <Notice
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={reload}
              >
                {t('sequences.reload')}
              </Button>
            }
          >
            {t('sequences.errorVersionConflict')}
          </Notice>
        </Match>
        <Match when={draft.failure()}>
          {(failure) => (
            <p class="mx-4 mb-2 text-xs text-failure" role="alert">
              {failureMessage(failure())}
            </p>
          )}
        </Match>
      </Switch>
      <Show when={senderDisconnected()}>
        <Notice>{t('sequences.senderDisconnected')}</Notice>
      </Show>
      <Show when={noSender()}>
        <p class="mx-4 mb-2 text-xs text-ink-muted">
          {t('sequences.connectGmail')}
        </p>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-8 lg:px-8 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+2rem)]">
        <Show
          when={tab() === 'steps'}
          fallback={
            <EnrollmentsView
              sequenceId={props.sequence.id}
              sequenceStatus={status()}
              enrollments={props.source.enrollments()}
              onEnroll={
                status() === 'active' ? () => setEnrolling(true) : undefined
              }
              onOpenContact={props.onOpenContact}
            />
          }
        >
          <Show when={!editable()}>
            <p class="mx-auto mb-4 max-w-3xl text-xs text-ink-muted">
              {t('sequences.pauseToEdit')}
            </p>
          </Show>
          <Show when={draft.draft()}>
            {(current) => (
              <SequenceEditor
                draft={current()}
                senders={senders.senders()}
                disabled={!editable() || props.source.removing()}
                onChange={draft.change}
              />
            )}
          </Show>
        </Show>
      </div>
      <Show when={enrolling()}>
        <EnrollView
          sequence={{ id: props.sequence.id, name: props.sequence.name }}
          onClose={() => setEnrolling(false)}
        />
      </Show>
      <DeleteDialog
        open={deleting()}
        onOpenChange={setDeleting}
        pending={props.source.removing()}
        title={t('sequences.deleteTitle', {
          name: props.sequence.name || t('sequences.untitled'),
        })}
        body={t('sequences.deleteBody')}
        deleteLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onDelete={() => fireAndForget(remove(), SURFACE)}
      />
    </>
  );
}

export function SequenceDetailView(props: {
  sequenceId: string;
  navigation?: JSX.Element;
  autofocusTitle?: boolean;
  onBack: () => void;
  onOpenContact: (contactId: string) => void;
}) {
  const source = useSequences().createSequence(() => props.sequenceId);
  return (
    <Switch>
      <Match when={source.sequence()}>
        {(sequence) => (
          <SequenceDetailContent
            source={source}
            sequence={sequence()}
            navigation={props.navigation}
            autofocusTitle={props.autofocusTitle}
            onBack={props.onBack}
            onOpenContact={props.onOpenContact}
          />
        )}
      </Match>
      <Match when={source.failure()}>
        {(failure) => (
          <EmptyStatePanel
            centered
            title={
              failure().kind === 'refused'
                ? t('sequences.unavailable')
                : t('sequences.loadFailed')
            }
            description={failureMessage(failure())}
            primaryAction={
              isRetryable(failure())
                ? {
                    label: t('sequences.retry'),
                    onClick: () => fireAndForget(source.refresh(), SURFACE),
                  }
                : undefined
            }
          >
            <Button
              type="button"
              variant="ghost"
              onClick={() => props.onBack()}
            >
              {t('sequences.allSequences')}
            </Button>
          </EmptyStatePanel>
        )}
      </Match>
      <Match when={source.pending()}>
        <ListSkeleton.Root label={t('sequences.loading')} class="px-4 pt-4">
          <ListSkeleton.Row>
            <ListSkeleton.Bar class="h-4 w-1/3" />
          </ListSkeleton.Row>
          <ListSkeleton.Row>
            <ListSkeleton.Bar class="h-24 w-full" />
          </ListSkeleton.Row>
        </ListSkeleton.Root>
      </Match>
    </Switch>
  );
}
