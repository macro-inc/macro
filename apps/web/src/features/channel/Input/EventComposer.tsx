import { createCalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import { EventForm } from '@app/features/calendar/components/composer/EventForm';
import {
  defaultEditorInitialValues,
  type EventEditorInitialValues,
  type EventEditorSubmitValues,
} from '@app/features/calendar/components/composer/event-form-model';
import { useEventEditor } from '@app/features/calendar/hooks/use-event-editor';
import { useUserId } from '@core/context/user';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { IUser } from '@core/user/types';
import { buildSimpleEntityUrl } from '@core/util/url';
import type { CalendarEvent as CalendarEventEntity } from '@service-email/generated/schemas/calendarEvent';
import { debounce } from '@solid-primitives/scheduled';
import { SendButton } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import {
  clearEventComposerDraft,
  loadEventComposerDraft,
  saveEventComposerDraft,
} from './utils/event-composer-draft';

export type EventComposerSendPayload = {
  eventId: string;
  title: string;
};

/**
 * The channel input's event face: the shared calendar event form (the same
 * one the calendar block's "New event" opens) that swaps in for the message
 * editor when the input is toggled into event mode. Guests are prefilled
 * with the channel's participants, and the created event's description
 * links back to the channel. Sending creates the event — inviting guests
 * the normal way, via email — and hands it to the host, which posts an
 * event mention into the channel.
 */
export function EventComposer(props: {
  /** Whether the composer is the visible face of the input. */
  active: boolean;
  /** Channel hosting the composer; the created event links back to it. */
  channelId: string;
  /** Channel participants prefilled as guests (the viewer excluded). */
  participants?: Accessor<IUser[]>;
  /** Fires after the event is created; the host posts it to the channel. */
  onSend: (event: EventComposerSendPayload) => void;
  /** The compose-mode switches, rendered in the composer footer. */
  modeSwitch?: JSX.Element;
  /**
   * Whether to focus the title input when the composer mounts already
   * active (e.g. a restored event-mode draft). Later activations always
   * focus. Defaults to `true`.
   */
  autofocus?: boolean;
  /**
   * localStorage key to persist the draft under, scoped by the host (e.g.
   * per channel). Without it the draft only lives as long as the composer.
   */
  draftPersistenceKey?: string;
}) {
  const currentUserId = useUserId();

  const prefillGuests = () =>
    (props.participants?.() ?? [])
      .filter((user) => user.id !== currentUserId() && user.email)
      .map((user) => user.email)
      .join(', ');

  // Per-host drafts follow the channel task drafts' persistence semantics:
  // kept until sent. Restored values are layered over fresh defaults so a
  // draft written by an older shape never leaves fields undefined.
  const restoredDraft = props.draftPersistenceKey
    ? loadEventComposerDraft(props.draftPersistenceKey)
    : null;
  const initialValues: EventEditorInitialValues = restoredDraft
    ? { ...defaultEditorInitialValues(), ...restoredDraft }
    : { ...defaultEditorInitialValues(), guests: prefillGuests() };

  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  let titleInput: HTMLInputElement | undefined;
  let lastSubmittedTitle = '';
  // Whether the current form content is the user's; only their edits are
  // worth persisting as a draft or protecting from guest re-prefills.
  let hasUserEdits = false;

  const clearDraft = () => {
    if (props.draftPersistenceKey) {
      clearEventComposerDraft(props.draftPersistenceKey);
    }
  };

  function handleCreated(event: CalendarEventEntity) {
    hasUserEdits = false;
    autoPrefillGuests = true;
    clearDraft();
    controller.replaceFromExternal({
      ...defaultEditorInitialValues(),
      guests: prefillGuests(),
    });
    props.onSend({
      eventId: event.id,
      title: event.title || lastSubmittedTitle,
    });
  }

  const editor = useEventEditor({
    event: () => undefined,
    onSaved: () => {},
    onCreated: handleCreated,
  });

  const debouncedDraftSave = debounce((values: EventEditorInitialValues) => {
    if (props.draftPersistenceKey) {
      saveEventComposerDraft(values, props.draftPersistenceKey);
    }
  }, 300);

  const controller = createCalendarEventFormController({
    initialValue: initialValues,
    calendarOptions: editor.calendarOptions,
    guestOptions: editor.guestOptions,
    onChange: (values) => {
      hasUserEdits = true;
      debouncedDraftSave(values);
    },
  });

  onCleanup(() => {
    // Flush the latest state so navigating away never drops edits that were
    // still inside the debounce window. Untouched prefills are not drafts.
    debouncedDraftSave.clear();
    if (hasUserEdits && props.draftPersistenceKey) {
      saveEventComposerDraft(controller.value(), props.draftPersistenceKey);
    }
  });

  // Track the channel participants into the guest prefill until the user
  // edits the form: the face can mount (restoring event mode on page load)
  // before the participants query resolves, and members can join or leave
  // while an untouched composer sits open.
  let autoPrefillGuests = restoredDraft === null;
  createEffect(() => {
    const prefill = prefillGuests();
    if (!autoPrefillGuests) return;
    if (controller.isDirty()) {
      autoPrefillGuests = false;
      return;
    }
    if (controller.value().guests === prefill) return;
    controller.replaceFromExternal({ ...controller.value(), guests: prefill });
  });

  // Guests are invited through the event itself (the normal email/.eml
  // flow); the description also links the invite back to the conversation
  // it came from.
  const withChannelLink = (
    values: EventEditorSubmitValues
  ): EventEditorSubmitValues => {
    const link = buildSimpleEntityUrl({ type: 'channel', id: props.channelId });
    const suffix = `Created from Macro channel: ${link}`;
    return {
      ...values,
      description: values.description
        ? `${values.description}\n\n${suffix}`
        : suffix,
    };
  };

  const handleSubmit = (values: EventEditorSubmitValues) => {
    if (editor.pending()) return;
    lastSubmittedTitle = values.title;
    editor.save(withChannelLink(values));
  };

  const canSend = () => controller.canSave() && !editor.pending();

  const handleSend = () => {
    const values = controller.submitValues();
    if (!values) return;
    handleSubmit(values);
  };

  const [attachHotkeys, composerHotkeyScope] = useHotkeyDOMScope(
    'channel-input-event-composer',
    true
  );
  onMount(() => {
    const container = containerRef();
    if (container) attachHotkeys(container);
  });

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: composerHotkeyScope,
    description: 'Create event and send',
    keyDownHandler: () => {
      handleSend();
      return true;
    },
    runWithInputFocused: true,
  });

  // Imperative DOM focus: entering event mode focuses the title input. The
  // first activation is the mount itself — a restored event-mode draft — and
  // only focuses when the host's autofocus allows it.
  let isFirstActivation = true;
  createEffect(
    on(
      () => props.active,
      (active) => {
        if (!active) return;
        const shouldFocus = isFirstActivation
          ? (props.autofocus ?? true)
          : true;
        isFirstActivation = false;
        if (!shouldFocus) return;
        requestAnimationFrame(() => titleInput?.focus());
      }
    )
  );

  return (
    // Compact edges matching the task face (content at px-3/pt-2). The form
    // caps its own height and scrolls internally so a custom recurrence
    // never grows the input past half the viewport.
    <div
      class="relative flex flex-col"
      tabIndex={-1}
      ref={setContainerRef}
      data-input-event-composer
    >
      <div class="px-3 pt-2">
        <EventForm
          controller={controller}
          pending={editor.pending()}
          hideFooter
          autofocusTitle={false}
          titleInputRef={(el) => {
            titleInput = el;
          }}
          class="max-h-[calc(50*var(--dvh,1dvh))]"
          onSubmit={handleSubmit}
        />
      </div>

      {/* A plain p-2 box puts an even 8px between the action row and the
          composer's bottom edges, mirroring the task face's footer. */}
      <div class="shrink-0 flex w-full flex-row justify-between items-center p-2 space-x-2">
        <div class="flex items-center gap-2">{props.modeSwitch}</div>
        <SendButton
          tooltip="Create event and send"
          shortcut="cmd+enter"
          aria-label="Create event and send"
          data-input-action="send-event"
          pending={editor.pending()}
          disabled={!canSend()}
          onPointerDown={(event) => {
            event.preventDefault();
            handleSend();
          }}
        />
      </div>
    </div>
  );
}
