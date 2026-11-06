import { ConfirmDialog, Dialog } from '@ui';
import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { EventEditor as EventEditorForm } from '../components/event-editor';
import type {
  AvailabilitySchedule,
  EventType,
  SchedulingMember,
} from '../core/types';
import { createEventEditor } from '../primitives/create-event-editor';

type EventEditorViewProps = {
  event: EventType;
  events: EventType[];
  schedules: AvailabilitySchedule[];
  members: SchedulingMember[];
  team: boolean;
  defaultHosts?: string[];
  saving: boolean;
  availability?: JSX.Element;
  submitLabel?: string;
  createActive?: boolean;
  dialogTitle?: string;
  link?: (slug: string) => string;
  onCopyLink?: (slug: string) => Promise<void>;
  onChange?: (event: EventType) => void;
  onSave: (event: EventType) => Promise<void>;
  onCancel: () => void;
};

export function EventEditor(props: EventEditorViewProps) {
  const editor = createEventEditor({
    event: props.event,
    events: () => props.events,
    hasSchedule: (id) => props.schedules.some((schedule) => schedule.id === id),
    createActive: () => props.createActive ?? false,
    defaultHosts: () => props.defaultHosts ?? props.event.hosts.slice(0, 1),
    defaultMode: () => (props.team ? 'collective' : 'individual'),
    missingHosts: (event) =>
      props.team
        ? event.hosts.filter(
            (id) => !props.members.some((member) => member.id === id)
          )
        : [],
    onChange: props.onChange,
    onSave: props.onSave,
  });
  const [confirmingDiscard, setConfirmingDiscard] = createSignal(false);
  const [stepMenuOpen, setStepMenuOpen] = createSignal(false);
  let returnFocus: HTMLElement | undefined;
  let discarding = false;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const requestClose = () => {
    if (props.saving || confirmingDiscard() || discarding) return;
    if (editor.hasChanges()) {
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined;
      setConfirmingDiscard(true);
    } else props.onCancel();
  };
  const discard = () => {
    if (props.saving) return;
    discarding = true;
    setConfirmingDiscard(false);
  };
  const savedEvent = () =>
    props.events.find((event) => event.id === props.event.id);
  const savedLink = () => {
    const slug = savedEvent()?.slug;
    return slug ? (props.link?.(slug) ?? `/${slug}`) : undefined;
  };
  const copySavedLink = async () => {
    const event = savedEvent();
    if (!event?.slug || !props.onCopyLink || props.saving) return;
    await props.onCopyLink(event.slug);
  };
  const form = () => (
    <EventEditorForm
      draft={editor.draft()}
      schedules={props.schedules}
      members={props.members}
      team={props.team}
      saving={props.saving}
      isNew={editor.isNew()}
      createActive={props.createActive ?? false}
      details={editor.details()}
      canResetTeamSettings={editor.canResetTeamSettings()}
      step={editor.step()}
      stepMenuOpen={stepMenuOpen()}
      onStepMenuOpenChange={setStepMenuOpen}
      issues={editor.issues()}
      validationAttempt={editor.validationAttempt()}
      submitError={editor.submitError()}
      availability={props.availability}
      submitLabel={props.submitLabel}
      link={props.link?.(editor.slug()) ?? `/${editor.slug()}`}
      savedLink={savedLink()}
      onCopyLink={
        props.onCopyLink && savedEvent()?.slug ? copySavedLink : undefined
      }
      onTitle={editor.setTitle}
      onUpdate={editor.update}
      onBuffers={editor.updateBuffers}
      onDailyLimitEnabled={editor.setDailyLimitEnabled}
      onAddDetail={editor.addDetail}
      onRemoveDetail={editor.removeDetail}
      onStep={editor.goToStep}
      onNext={editor.next}
      onBack={editor.back}
      onSave={() => editor.save()}
      onCancel={requestClose}
    />
  );
  return (
    <>
      <Show when={props.dialogTitle} fallback={form()}>
        <Dialog
          open
          onOpenChange={(open) => !open && requestClose()}
          position="center"
          onEscapeKeyDown={(event) => {
            // The drawer and dropdown use separate dismissable-layer stacks.
            if (stepMenuOpen()) event.preventDefault();
          }}
          animate
          class="w-full max-w-[min(42rem,calc(100vw-16px))] overflow-hidden"
        >
          <Dialog.Title class="sr-only">{props.dialogTitle}</Dialog.Title>
          {form()}
        </Dialog>
      </Show>
      <ConfirmDialog
        open={confirmingDiscard()}
        onOpenChange={setConfirmingDiscard}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (discarding) {
            discarding = false;
            returnFocus = undefined;
            // The confirmation releases its focus trap before the owner closes
            // the editor and restores the booking-list opener.
            queueMicrotask(() => {
              if (!disposed && !props.saving) props.onCancel();
            });
          } else if (returnFocus?.isConnected) {
            returnFocus.focus({ preventScroll: true });
          }
        }}
        title="Discard changes?"
        body="Your changes to this booking link have not been saved."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
        pending={props.saving}
        onConfirm={discard}
      />
    </>
  );
}
