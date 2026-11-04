import { ViewShell } from '@app/components/view-shell';
import { composePropsFromParams } from '@app/features/email-compose/compose-params';
import { EmailCompose } from '@app/features/email-compose/email-compose';
import { t } from '@app/lib/i18n';
import { useEntryProps } from '@app/lib/split-router';
import { usePageViewTracking } from '@components/app/split-layout/split-router/app-route-shell';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import { Button } from '@ui';
import { useEmailView } from '../email-view-context';

/**
 * A new email inside the Email view, in the list's place beside the Email
 * sidebar. Back returns to the list.
 */
export function EmailComposeRouteView() {
  usePageViewTracking('email-compose');
  const { closeThread } = useEmailView();
  const props = composePropsFromParams(
    useEntryProps<Record<string, unknown>>()
  );

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
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
      <div class="relative min-h-0 min-w-0 flex-1">
        <EmailCompose {...props} />
      </div>
    </div>
  );
}
