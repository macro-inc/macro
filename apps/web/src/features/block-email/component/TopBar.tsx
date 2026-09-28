import { ResponsiveBlockToolbar } from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { EmailThreadControls } from './EmailThreadControls';
import {
  type EmailThreadToolsOptions,
  useEmailThreadTools,
} from './useEmailThreadTools';

export function TopBar(props: EmailThreadToolsOptions) {
  const { isInvite, tools, menuTools, controls } = useEmailThreadTools(props);

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          class="ph-no-capture"
          iconType={isInvite() ? 'emailInvite' : 'email'}
          colorIcon={isInvite()}
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

      <SplitHeaderRight>
        <EmailThreadControls {...controls} />
      </SplitHeaderRight>

      <ResponsiveBlockToolbar
        tools={tools}
        menuTools={menuTools}
        ops={[]}
        id={props.id}
        itemType="email"
        name={props.title}
      />
    </>
  );
}
