import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { hasPermissions, Permissions } from '@core/component/SharePermissions';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import {
  ENABLE_EMAIL_SHARING,
  ENABLE_PROPERTIES_METADATA,
} from '@core/constant/featureFlags';
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
      <SplitToolbarLeft>
        <div class="flex items-center h-full p-1">
          <SplitHeaderBadge text="beta" tooltip="Email is in Beta" />
        </div>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <div class="flex items-center gap-2">
          <Show when={ENABLE_PROPERTIES_METADATA}>
            <EmailPropertiesModal
              buttonSize="sm"
              subject={props.title}
              canEdit={hasPermissions(
                email.permissions().type,
                Permissions.CAN_EDIT
              )}
            />
          </Show>
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
