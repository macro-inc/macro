import { ResponsiveBlockToolbar } from '@components/app/ResponsiveBlockToolbar';
import { BlockSplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  SplitTitleFileMenu,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { EmailThreadControls } from './EmailThreadControls';
import {
  EmailThreadControlGroups,
  EmailThreadHeaderActions,
} from './EmailThreadHeaderActions';
import {
  type EmailThreadToolsOptions,
  useEmailThreadTools,
} from './useEmailThreadTools';

export function TopBar(props: EmailThreadToolsOptions) {
  const panel = useSplitPanelOrThrow();
  const {
    isInvite,
    tools,
    menuTools,
    controls,
    openShare,
    emailEntity,
    permissions,
  } = useEmailThreadTools(props);

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
        <Show
          when={!isTouchDevice()}
          fallback={<EmailThreadControls {...controls} />}
        >
          <EmailThreadHeaderActions
            controls={
              <EmailThreadControlGroups
                controls={controls}
                navigation={props.listNavigation}
              />
            }
            share={
              <Show when={ENABLE_EMAIL_SHARING}>
                <ShareTrigger
                  onClick={openShare}
                  id={props.id}
                  blockType="email"
                  hotkeyScope={panel.splitHotkeyScope}
                />
              </Show>
            }
          />
        </Show>
      </SplitHeaderRight>

      <Show
        when={isTouchDevice()}
        fallback={
          <SplitTitleFileMenu>
            <BlockSplitFileMenu
              id={props.id}
              itemType="email"
              name={props.title}
              ops={[]}
              tools={menuTools}
              entity={emailEntity()}
              permissions={permissions()}
              buttonClass="order-first"
            />
          </SplitTitleFileMenu>
        }
      >
        <ResponsiveBlockToolbar
          tools={tools}
          menuTools={menuTools}
          ops={[]}
          id={props.id}
          itemType="email"
          name={props.title}
        />
      </Show>
    </>
  );
}
