import XIcon from '@phosphor/x.svg';
import { Button, Dialog, Panel } from '@ui';
import { EventEditorForm } from './EventEditorForm';
import type { CalendarEvent } from './types';
import { useEventEditor } from './useEventEditor';

/**
 * Hosts the shared event form in a dialog and owns create/edit mutations.
 * Editing keeps calendar and guest fields visible but disabled because those
 * values are not safely patchable by the current edit flow.
 */
export function EventEditorDialog(props: {
  open: boolean;
  /** Present when editing; absent when creating. */
  event?: CalendarEvent;
  onClose: () => void;
}) {
  const isEdit = () => props.event !== undefined;
  const editor = useEventEditor({
    event: () => props.event,
    onSaved: props.onClose,
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && !editor.pending() && props.onClose()}
    >
      <Panel
        depth={2}
        class="w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl text-ink"
      >
        <Panel.Header class="gap-1 px-2">
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            disabled={editor.pending()}
          >
            <XIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
            {isEdit() ? 'Edit event' : 'New event'}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body>
          <EventEditorForm
            initialValues={editor.initialValues()}
            disabledFields={editor.disabledFields}
            calendarOptions={editor.calendarOptions()}
            guestOptions={editor.guestOptions}
            showRecurringEditNotice={editor.showRecurringEditNotice()}
            pending={editor.pending()}
            onCancel={props.onClose}
            onSubmit={editor.save}
          />
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
