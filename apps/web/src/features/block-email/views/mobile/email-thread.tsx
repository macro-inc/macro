import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import {
  type EmailThreadToolsOptions,
  useEmailThreadTools,
} from '../../component/useEmailThreadTools';
import {
  type EmailBlockViewProps,
  EmailThreadHostView,
} from '../../EmailThreadHostView';

/**
 * What a view that lists the thread adds: where its title menu's actions go
 * once they take the thread out of the list.
 */
export type MobileEmailThreadList = Pick<
  EmailThreadToolsOptions,
  'onMarkedUnread' | 'onDeleted' | 'listNavigation'
> & { onEmailReminderSaved?: () => void | Promise<void> };

/**
 * Back, the subject with its menu, and Info. Every other thread action lives
 * in the title menu.
 */
function MobileEmailThreadHeader(
  props: EmailThreadToolsOptions & {
    onEmailReminderSaved?: () => void | Promise<void>;
  }
) {
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

      <SplitFileMenu
        id={props.id}
        itemType="email"
        entityKind="email"
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
          actions.excludeFromCrm,
          actions.moveToFolder,
          actions.downloadEml,
          actions.trash,
          actions.senderToSignal,
          actions.senderToNoise,
          actions.blockSender,
        ]}
        entity={emailEntity()}
        permissions={permissions()}
        onEmailReminderSaved={props.onEmailReminderSaved}
      />
    </>
  );
}

/**
 * An email thread on touch. The email block shows it, and so does touch Mail
 * beside its list (inside a `SplitHeaderScope`), so a thread has one header
 * in both.
 */
export function MobileEmailThread(
  props: EmailBlockViewProps & { list?: MobileEmailThreadList }
) {
  return (
    <EmailThreadHostView
      title={props.title}
      threadId={props.threadId}
      source={props.source}
      host={props.host}
      topBar={(context) => (
        <MobileEmailThreadHeader
          id={props.threadId()}
          title={props.title}
          onCreateTask={context.createTask}
          onCreateEvent={context.createEvent}
          canCreateEvent={context.canCreateEvent}
          onMarkedUnread={props.list?.onMarkedUnread}
          onDeleted={props.list?.onDeleted}
          listNavigation={props.list?.listNavigation}
          onEmailReminderSaved={props.list?.onEmailReminderSaved}
        />
      )}
    />
  );
}
