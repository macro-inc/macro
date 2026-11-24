import { usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import type { StandaloneComposerProps } from '../../CalendarComposerEditor';
import { useDayDraftRange } from '../../context/day-draft-range-context';
import {
  useCalendarGuestInvitesFlag,
  useCalendarInvitationForwardFlag,
} from '../../hooks/use-calendar-ui-flag';
import { useEventEditor } from '../../hooks/use-event-editor';
import { useSyncedCalendarEvent } from '../../hooks/use-synced-calendar-event';
import { createCalendarComposerSetup } from '../../primitives/create-calendar-composer-setup';
import { createComposerSuggestions } from '../../primitives/create-composer-suggestions';
import { defaultComposerValues } from '../../primitives/default-composer-values';
import { useCalendarPreferences } from '../../utils/preferences';

/** Construct one editor model for either layout; views retain DOM and placement ownership. */
export function createStandaloneComposerSetup(props: StandaloneComposerProps) {
  const dayDraftRange = useDayDraftRange();
  const [preferences] = useCalendarPreferences();
  const guestInvitesEnabled = useCalendarGuestInvitesFlag();
  const forwardEnabled = useCalendarInvitationForwardFlag();
  const saved = () => {
    props.onSaved?.();
    props.onClose();
  };
  const editor = useEventEditor({
    event: () => props.event,
    macroCallsEnabled: () => true,
    guestInvitesEnabled,
    invitationForwardEnabled: forwardEnabled,
    syncedEvent: useSyncedCalendarEvent(() => props.event),
    onDetailsLocked: () => model.resetDetails(),
    onCreated: (created) => props.onCreated?.(created),
    onSaved: saved,
  });
  const isEdit = () => props.event !== undefined;
  const initial =
    editor.initialValues() ??
    props.initialValues ??
    defaultComposerValues(new Date(), true);
  const { controller, model } = createCalendarComposerSetup(
    {
      form: {
        initialValue: initial,
        isEdit: isEdit(),
        calendarOptions: editor.calendarOptions,
        guestOptions: editor.guestOptions,
      },
    },
    () => ({
      get pending() {
        return editor.pending();
      },
      get isEdit() {
        return isEdit();
      },
      get timeFormat() {
        return preferences.timeFormat;
      },
      // The existing form's wall-clock fields use the viewer's local zone.
      initialMetadata: {
        visibility: props.event?.visibility,
        transparency: props.event?.transparency,
      },
      get disabledFields() {
        return editor.disabledFields();
      },
      get addOnlyGuests() {
        return editor.addOnlyGuests();
      },
      get guestsReadOnlyReason() {
        return editor.guestsReadOnlyReason();
      },
      get guestListHidden() {
        return editor.guestListHidden();
      },
      get guestPolicyEditable() {
        return editor.guestPolicyEditable();
      },
      get detailsReadOnlyReason() {
        return editor.detailsReadOnlyReason();
      },
      get showRecurringEditNotice() {
        return editor.showRecurringEditNotice();
      },
      onSubmit: (values, scope, metadata) =>
        fireAndForget(
          editor.save(values, scope, metadata),
          'calendar-composer-save'
        ),
      onDirtyChange: (dirty) => props.onDirtyChange?.(dirty),
      onCalendarChange: (id, color) => props.onCalendarChange?.(id, color),
    })
  );
  dayDraftRange?.bind(model);
  const suggestions = createComposerSuggestions({
    suggestion: isEdit() ? undefined : props.suggestedValues,
    isDirty: model.isDirty,
    apply: (values) =>
      controller.replaceFromExternal({ ...controller.state(), ...values }),
  });
  fireAndForget(suggestions.completion, 'calendar-composer-suggestions');
  usePending('calendar.composer.suggestions', suggestions.pending);
  return {
    model,
    saveError: editor.saveError,
    replacementRequest: () => {
      const submission = model.submission();
      if (!submission) return;
      return editor.replacementRequest(
        submission.values,
        submission.scope,
        submission.changes
      );
    },
    suggestionsPending: suggestions.pending,
    guestInvitesEnabled,
    forwardEnabled,
    saved,
  };
}
