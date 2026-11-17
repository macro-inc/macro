import { useQuickCallsFlag } from '@app/features/meetings/use-quick-calls-flag';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { createMemo, type JSX, Show } from 'solid-js';
import type { EventEditorInitialValues } from '../../components/composer/event-form-model';
import type { CreatedCalendarEvent } from '../../core/composer';
import type { CalendarEvent } from '../../types';
import { StandaloneComposerEditor } from './StandaloneComposerEditor';

export interface StandaloneComposerProps {
  event?: CalendarEvent;
  initialValues?: EventEditorInitialValues;
  suggestedValues?: Promise<Partial<EventEditorInitialValues>>;
  pinned?: boolean;
  onTogglePin?: () => void;
  onHeaderPointerDown?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCreated?: (created: CreatedCalendarEvent) => void;
  onSaved?: () => void;
  onClose: () => void;
}

/** Each mounted instance owns one draft; placement changes must not remount it. */
export function StandaloneComposer(props: StandaloneComposerProps) {
  const quickCalls = useQuickCallsFlag();
  const ready = createMemo(
    (settled) => settled || !quickCalls().loading,
    false
  );
  usePending('calendar.composer.flags', () => !ready());
  return (
    <Show
      when={ready()}
      fallback={
        <p role="status" class="p-4">
          {t('calendar.loadingEvent')}
        </p>
      }
    >
      <StandaloneComposerEditor
        {...props}
        macroCallsEnabled={() => quickCalls().enabled && !quickCalls().loading}
      />
    </Show>
  );
}
