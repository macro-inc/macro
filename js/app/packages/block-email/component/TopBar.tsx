import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useBlockId } from '@core/block';
import { ENABLE_PROPERTIES_METADATA } from '@core/constant/featureFlags';
import { Show } from 'solid-js';
import { EmailPropertiesModal } from './EmailPropertiesModal';

export function TopBar(props: { title: string }) {
  const blockId = useBlockId();

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
        <Show when={ENABLE_PROPERTIES_METADATA}>
          <EmailPropertiesModal documentId={blockId} buttonSize="sm" />
        </Show>
      </SplitToolbarRight>
    </>
  );
}
