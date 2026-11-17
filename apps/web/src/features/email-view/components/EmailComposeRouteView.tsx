import { composePropsFromParams } from '@app/features/email-compose/compose-params';
import { EmailCompose } from '@app/features/email-compose/email-compose';
import { useEntryProps } from '@app/lib/split-router';
import { usePageViewTracking } from '@components/app/split-layout/split-router/app-route-shell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { useEmailView } from '../email-view-context';
import { EmailComposeRoute } from '../views/email-compose-route';
import { MobileEmailComposeRoute } from '../views/mobile/email-compose-route';

/**
 * A new email inside the Email view: in the list's place beside the Email
 * sidebar on desktop, in the preview pane beside the list on wide touch.
 */
export function EmailComposeRouteView() {
  usePageViewTracking('email-compose');
  const { closeThread } = useEmailView();
  const props = composePropsFromParams(
    useEntryProps<Record<string, unknown>>()
  );

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <EmailComposeRoute onBack={closeThread}>
          <EmailCompose {...props} />
        </EmailComposeRoute>
      }
    >
      <MobileEmailComposeRoute>
        <EmailCompose {...props} />
      </MobileEmailComposeRoute>
    </Show>
  );
}
