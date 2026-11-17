import { t } from '@app/lib/i18n';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Spinner } from '@ui';
import { type Accessor, Show } from 'solid-js';
import { ComposerRoot } from './components/composer/root/ComposerRoot';
import { createStandaloneComposerSetup } from './views/composer/create-standalone-composer-setup';
import { DesktopComposer } from './views/composer/DesktopComposer';
import { MobileComposerHost } from './views/composer/mobile/MobileComposerHost';
import type { StandaloneComposerProps } from './views/composer/StandaloneComposer';
import { StandaloneComposerActions } from './views/composer/StandaloneComposerActions';

/** One data owner beneath the readiness gate; layouts only compose its model. */
export function CalendarComposerEditor(
  props: StandaloneComposerProps & { macroCallsEnabled: Accessor<boolean> }
) {
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
            disabled={setup.model.isDirty() || setup.model.options.pending}
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
            <DesktopComposer
              pinned={props.pinned}
              onTogglePin={props.onTogglePin}
              onHeaderPointerDown={props.onHeaderPointerDown}
              onClose={props.onClose}
              onCancel={props.onClose}
              macroCallsEnabled={props.macroCallsEnabled()}
              saveError={setup.saveError()}
              resolveAppLink={resolveAppLink}
            >
              {extras()}
            </DesktopComposer>
          }
        >
          <MobileComposerHost
            initialHeight={props.initialDrawerHeight}
            macroCallsEnabled={props.macroCallsEnabled()}
            saveError={setup.saveError()}
            resolveAppLink={resolveAppLink}
          >
            {extras()}
          </MobileComposerHost>
        </Show>
      </ComposerRoot>
    </div>
  );
}
