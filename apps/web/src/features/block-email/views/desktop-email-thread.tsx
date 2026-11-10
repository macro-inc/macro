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
import { Show } from 'solid-js';
import {
  type EmailThreadToolsOptions,
  useEmailThreadTools,
} from '../component/useEmailThreadTools';
import {
  type EmailBlockViewProps,
  EmailThreadHostView,
} from '../EmailThreadHostView';
import {
  desktopEmailThreadMenu,
  EmailThreadActions,
  EmailThreadControlGroups,
  EmailThreadHeaderActions,
} from './desktop-email-thread-parts';

function DesktopEmailThreadHeader(props: EmailThreadToolsOptions) {
  const panel = useSplitPanelOrThrow();
  const { isInvite, actions, controls, openShare, emailEntity, permissions } =
    useEmailThreadTools(props);

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
                size="md"
                onClick={openShare}
                id={props.id}
                blockType="email"
                hotkeyScope={panel.splitHotkeyScope}
              />
            </Show>
          }
        />
      </SplitHeaderRight>

      <SplitTitleFileMenu>
        <BlockSplitFileMenu
          id={props.id}
          itemType="email"
          name={props.title}
          ops={[]}
          tools={desktopEmailThreadMenu(actions)}
          entity={emailEntity()}
          permissions={permissions()}
          buttonClass="order-first"
        />
      </SplitTitleFileMenu>
    </>
  );
}

/** The email block on desktop: a thread in its own split or an inline preview. */
export function DesktopEmailThread(props: EmailBlockViewProps) {
  return (
    <EmailThreadHostView
      title={props.title}
      threadId={props.threadId}
      source={props.source}
      threadTransport={props.threadTransport}
      host={props.host}
      topBar={(context) => (
        <DesktopEmailThreadHeader
          id={props.threadId()}
          title={props.title}
          onCreateTask={context.createTask}
          onCreateEvent={context.createEvent}
          canCreateEvent={context.canCreateEvent}
        />
      )}
      actions={(context) => (
        <EmailThreadActions
          title={props.title}
          onCreateTask={context.createTask}
        />
      )}
    />
  );
}
