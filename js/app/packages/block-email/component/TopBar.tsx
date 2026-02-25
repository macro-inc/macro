import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { SplitToolbarRight } from '@app/component/split-layout/components/SplitToolbar';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { Show } from 'solid-js';
import { EmailPropertiesButton } from './EmailPropertiesModal';

export function TopBar(props: {
  id: string;
  title: string;
  isDraft?: boolean;
}) {
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          iconType="email"
          label={props.title}
          badges={
            props.isDraft
              ? [
                  <SplitHeaderBadge
                    text="draft"
                    tooltip="This is a Draft Email"
                  />,
                ]
              : undefined
          }
        />
      </SplitHeaderLeft>

      <SplitToolbarRight>
        <EmailPropertiesButton buttonSize="sm" />
        <Show when={ENABLE_EMAIL_SHARING}>
          <ShareTrigger />
        </Show>
      </SplitToolbarRight>
    </>
  );
}
