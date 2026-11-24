import { t } from '@app/lib/i18n';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Spinner } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { EventEditorInitialValues } from './components/composer/event-form-model';
import { ComposerRoot } from './components/composer/parts/ComposerRoot';
import type { CreatedCalendarEvent } from './core/composer';
import type { CalendarEvent } from './types';
import { CalendarDesktopPlacement } from './views/composer/CalendarDesktopPlacement';
import { createStandaloneComposerSetup } from './views/composer/create-standalone-composer-setup';
import { PhoneSheetComposer } from './views/composer/mobile/PhoneSheetComposer';
import { StandaloneComposerActions } from './views/composer/StandaloneComposerActions';

export interface StandaloneComposerProps {
  event?: CalendarEvent;
  initialValues?: EventEditorInitialValues;
  suggestedValues?: Promise<Partial<EventEditorInitialValues>>;
  initialDrawerHeight?: number;
  pinned?: boolean;
  onTogglePin?: () => void;
  onHeaderPointerDown?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCreated?: (created: CreatedCalendarEvent) => void;
  onSaved?: () => void;
  onClose: () => void;
}

/** One data owner beneath the readiness gate; layouts only compose its model. */
export function CalendarComposerEditor(props: StandaloneComposerProps) {
  const resolveAppLink = useMacroMentionLinkResolver();
  const [attachHotkeys] = useHotkeyDOMScope('event-composer', true);
  const setup = createStandaloneComposerSetup(props);
  const extras = () => (
    <>
      <Show when={setup.suggestionsPending()}>
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
            guestInvitesEnabled={setup.guestInvitesEnabled}
            forwardEnabled={setup.forwardEnabled}
            disabled={!setup.model.canSave() || setup.model.options.pending}
            replacementRequest={setup.replacementRequest}
            onDone={setup.saved}
          />
        )}
      </Show>
    </>
  );
  return (
    <div ref={attachHotkeys} class="flex h-full min-h-0 flex-col text-ink">
      <ComposerRoot model={setup.model} class="min-h-0 flex-1">
        <Show
          when={isTouchDevice()}
          fallback={
            <CalendarDesktopPlacement
              pinned={props.pinned}
              onTogglePin={props.onTogglePin}
              onHeaderPointerDown={props.onHeaderPointerDown}
              onClose={props.onClose}
              saveError={setup.saveError()}
              resolveAppLink={resolveAppLink}
            >
              {extras()}
            </CalendarDesktopPlacement>
          }
        >
          <PhoneSheetComposer
            initialHeight={props.initialDrawerHeight}
            saveError={setup.saveError()}
            resolveAppLink={resolveAppLink}
          >
            {extras()}
          </PhoneSheetComposer>
        </Show>
      </ComposerRoot>
    </div>
  );
}
