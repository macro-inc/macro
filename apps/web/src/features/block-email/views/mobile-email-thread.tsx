import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { BlockSplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import {
  type EmailThreadToolsOptions,
  useEmailThreadTools,
} from '../component/useEmailThreadTools';
import {
  type EmailBlockViewProps,
  EmailThreadHostView,
} from '../EmailThreadHostView';

/**
 * Back, the subject with its menu, and Info. Every other thread action lives
 * in the title menu.
 */
function MobileEmailThreadHeader(props: EmailThreadToolsOptions) {
  const { isInvite, actions, emailEntity, permissions } =
    useEmailThreadTools(props);

  return (
    <>
      <MobileHeader trailing={<MobileHeader.Info />}>
        <MobileHeader.Title
          class="ph-no-capture"
          iconType={isInvite() ? 'emailInvite' : 'email'}
          colorIcon={isInvite()}
          label={props.title}
        />
      </MobileHeader>

      <BlockSplitFileMenu
        id={props.id}
        itemType="email"
        name={props.title}
        ops={[]}
        tools={[
          actions.markDone,
          actions.markNotDone,
          actions.markUnread,
          actions.markRead,
          actions.askMacro,
          actions.createTask,
          actions.createEvent,
          actions.share,
          actions.moveToFolder,
          actions.downloadEml,
          actions.trash,
          actions.senderToSignal,
          actions.senderToNoise,
          actions.blockSender,
        ]}
        entity={emailEntity()}
        permissions={permissions()}
      />
    </>
  );
}

/** The email block on touch, where every thread opens as a block. */
export function MobileEmailThread(props: EmailBlockViewProps) {
  return (
    <EmailThreadHostView
      title={props.title}
      threadId={props.threadId}
      source={props.source}
      threadTransport={props.threadTransport}
      host={props.host}
      topBar={(context) => (
        <MobileEmailThreadHeader
          id={props.threadId()}
          title={props.title}
          onCreateTask={context.createTask}
          onCreateEvent={context.createEvent}
          canCreateEvent={context.canCreateEvent}
        />
      )}
    />
  );
}
