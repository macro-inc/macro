import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { SplitToolbarRight } from '@app/component/split-layout/components/SplitToolbar';
import { hasPermissions, Permissions } from '@core/component/SharePermissions';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { Show } from 'solid-js';
import { useEmailContext } from './EmailContext';
import { EmailPropertiesModal } from './EmailPropertiesModal';

export function TopBar(props: { id: string; title: string }) {
  const email = useEmailContext();

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel iconType="email" label={props.title} />
      </SplitHeaderLeft>

      <SplitToolbarRight>
        <div class="flex items-center gap-2">
          <EmailPropertiesModal
            buttonSize="sm"
            subject={props.title}
            canEdit={hasPermissions(
              email.permissions().type,
              Permissions.CAN_EDIT
            )}
          />
          <Show when={ENABLE_EMAIL_SHARING}>
            <ShareButton
              id={props.id}
              name={props.title}
              itemType="email"
              userPermissions={email.permissions().type}
            />
          </Show>
        </div>
      </SplitToolbarRight>
    </>
  );
}
