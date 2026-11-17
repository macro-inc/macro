import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import { Spinner } from '@ui';
import { type Accessor, Show } from 'solid-js';
import { createCalendarEventFormController } from '../../components/composer/create-calendar-event-form-controller';
import { ComposerRoot } from '../../components/composer/root/ComposerRoot';
import {
  useCalendarGuestInvitesFlag,
  useCalendarInvitationForwardFlag,
} from '../../hooks/use-calendar-ui-flag';
import { useEventEditor } from '../../hooks/use-event-editor';
import { useSyncedCalendarEvent } from '../../hooks/use-synced-calendar-event';
import { createCalendarComposer } from '../../primitives/create-calendar-composer';
import { createComposerSuggestions } from '../../primitives/create-composer-suggestions';
import { defaultComposerValues } from '../../primitives/default-composer-values';
import { useCalendarPreferences } from '../../utils/preferences';
import { DesktopComposer } from './DesktopComposer';
import type { StandaloneComposerProps } from './StandaloneComposer';
import { StandaloneComposerActions } from './StandaloneComposerActions';

/** Production data composition shared by every desktop placement of one editor. */
export function StandaloneComposerEditor(
  props: StandaloneComposerProps & { macroCallsEnabled: Accessor<boolean> }
) {
  const [preferences] = useCalendarPreferences();
  const resolveAppLink = useMacroMentionLinkResolver();
  const [attachHotkeys] = useHotkeyDOMScope('event-composer', true);
  const guestInvitesEnabled = useCalendarGuestInvitesFlag();
  const forwardEnabled = useCalendarInvitationForwardFlag();
  const saved = () => {
    props.onSaved?.();
    props.onClose();
  };
  const editor = useEventEditor({
    event: () => props.event,
    macroCallsEnabled: props.macroCallsEnabled,
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
    defaultComposerValues(new Date(), props.macroCallsEnabled());
  const initialValue =
    !isEdit() && initial.conference === 'macro' && !props.macroCallsEnabled()
      ? { ...initial, conference: 'none' as const }
      : initial;
  const controller = createCalendarEventFormController({
    initialValue,
    isEdit: isEdit(),
    calendarOptions: editor.calendarOptions,
    guestOptions: editor.guestOptions,
  });
  const model = createCalendarComposer({
    controller,
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
    initialMetadata: { visibility: props.event?.visibility },
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
  });
  const suggestions = createComposerSuggestions({
    suggestion: isEdit() ? undefined : props.suggestedValues,
    isDirty: model.isDirty,
    apply: (values) =>
      controller.replaceFromExternal({ ...controller.state(), ...values }),
  });
  fireAndForget(suggestions.completion, 'calendar-composer-suggestions');
  usePending('calendar.composer.suggestions', suggestions.pending);

  return (
    <div ref={attachHotkeys} class="flex h-full min-h-0 flex-col text-ink">
      <ComposerRoot model={model} class="min-h-0 flex-1">
        <DesktopComposer
          pinned={props.pinned}
          onTogglePin={props.onTogglePin}
          onClose={props.onClose}
          onCancel={props.onClose}
          macroCallsEnabled={props.macroCallsEnabled()}
          saveError={editor.saveError()}
          resolveAppLink={resolveAppLink}
        >
          <Show when={suggestions.pending()}>
            <Spinner
              size="sm"
              label={t('calendar.readingEventSuggestion')}
              class="text-ink-extra-muted"
            />
          </Show>
          <Show when={props.event}>
            {(event) => (
              <StandaloneComposerActions
                event={event()}
                guestInvitesEnabled={guestInvitesEnabled}
                forwardEnabled={forwardEnabled}
                disabled={model.isDirty() || editor.pending()}
                onDone={saved}
              />
            )}
          </Show>
        </DesktopComposer>
      </ComposerRoot>
    </div>
  );
}
