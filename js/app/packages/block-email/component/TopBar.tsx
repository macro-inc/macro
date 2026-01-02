import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { ENABLE_PROPERTIES_METADATA } from '@core/constant/featureFlags';
import { Show } from 'solid-js';
import { EmailPropertiesModal } from './EmailPropertiesModal';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import { Permissions } from '@core/component/SharePermissions';

export function TopBar(props: { id: string; title: string }) {
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
        <ShareButton
          id={props.id}
          name={props.title}
          itemType="email"
          userPermissions={Permissions.NO_ACCESS}
        />

        <Show when={ENABLE_PROPERTIES_METADATA}>
          <EmailPropertiesModal buttonSize="sm" subject={props.title} />
        </Show>
      </SplitToolbarRight>
    </>
  );
}
