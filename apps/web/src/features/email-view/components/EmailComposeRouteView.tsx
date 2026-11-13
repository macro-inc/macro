import { ViewShell } from '@app/components/view-shell';
import { composePropsFromParams } from '@app/features/email-compose/compose-params';
import { EmailCompose } from '@app/features/email-compose/email-compose';
import { t } from '@app/lib/i18n';
import { useEntryProps } from '@app/lib/split-router';
import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import { usePageViewTracking } from '@components/app/split-layout/split-router/app-route-shell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useEmailView } from '../email-view-context';

/**
 * A new email inside the Email view: in the list's place beside the Email
 * sidebar on desktop, in the preview pane beside the list on wide touch.
 * Back returns to the list.
 */
export function EmailComposeRouteView() {
  usePageViewTracking('email-compose');
  const { closeThread } = useEmailView();
  const props = composePropsFromParams(
    useEntryProps<Record<string, unknown>>()
  );

  return (
    // Touch shows the composer's own header, as the phone composer does.
    <SplitHeaderScope.Root when={isTouchDevice()}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <Show
          when={isTouchDevice()}
          fallback={
            <ViewShell.TopBar>
              <Button
                variant="ghost"
                size="icon-md"
                tooltip={t('commands.goBack')}
                aria-label={t('commands.goBack')}
                onClick={closeThread}
              >
                <ArrowLeftIcon class="size-4" />
              </Button>
            </ViewShell.TopBar>
          }
        >
          <SplitHeaderScope.TopBar />
        </Show>
        <div class="relative min-h-0 min-w-0 flex-1">
          <EmailCompose {...props} />
        </div>
      </div>
    </SplitHeaderScope.Root>
  );
}
