import { EmailFormContextProvider } from '@app/features/email-compose/context/email-form-context';
import { EmailComposeView } from '@app/features/email-compose/views/email-compose';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import type { JSX } from 'solid-js';
import { type Accessor, Match, Show, Switch } from 'solid-js';
import type { EmailThreadHost } from '../context/email-thread-context';
import { useEmailThreadState } from '../context/email-thread-state-context';
import { useEmailThreadViewContext } from '../context/email-thread-view-context';
import { createThreadNavigation } from '../primitives/thread-navigation';
import { createThreadReplyArea } from '../primitives/thread-reply-area';
import { BottomReplyButtons } from './bottom-reply-buttons';
import { MessageList } from './message-list';
import { MobileEmailComposeDrawer } from './mobile-email-compose-drawer';
export type EmailThreadViewProps = {
  title: string;
  threadId: Accessor<string>;
  host?: EmailThreadHost;
  header?: JSX.Element;
  actions?: JSX.Element;
};
export function EmailThreadView(props: EmailThreadViewProps) {
  const context = useEmailThreadState();
  const viewContext = useEmailThreadViewContext();
  const threadContext = viewContext.thread;
  const isTouchDevice = threadContext.isTouch;
  const navigation = createThreadNavigation(
    props,
    context,
    threadContext,
    props.host
  );
  const {
    showMiddleMessages,
    keyboardSelecting,
    armKeyboardPointer,
    leaveHiddenChip,
    setUserOpenedMiddle,
  } = navigation;
  const {
    info: emailReplyInfo,
    inFlow: replyInputInFlow,
    mobileMessage: mobileBottomReplyMessage,
  } = createThreadReplyArea({
    threadId: props.threadId,
    isTouch: threadContext.isTouch,
    messages: context.messages.list,
    allMessages: context.messages.unfiltered,
    canCompose: () => context.permissions().isOwner,
    drafts: context.drafts,
    bottomReply: {
      open: context.messages.bottomReplyOpen,
      setOpen: context.messages.setBottomReplyOpen,
    },
    mobileReply: context.mobileReplyComposer,
  });
  return (
    <Show when={!threadContext.viewerLoading()}>
      <Switch>
        <Match
          when={
            emailReplyInfo()?.replyingTo == null &&
            emailReplyInfo()?.draft?.db_id != null &&
            emailReplyInfo()?.draft
          }
        >
          {(draft) => (
            // The email block is bottom-anchored (no default panel inset),
            // so the compose branch pads around the chrome itself.
            <div class="size-full touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
              <EmailComposeView
                context={viewContext.compose}
                host={viewContext.composeHost}
                draft={draft()}
                recipientOptions={context.recipientOptions}
                onRecipientsChange={context.onRecipientsChange}
              />
            </div>
          )}
        </Match>

        <Match when={true}>
          <EmailFormContextProvider
            context={{
              viewerEmail: viewContext.compose.viewerEmail,
              inboxes: viewContext.compose.accounts.inboxes,
            }}
            formOptions={{
              getMessageById: (id) =>
                context.messages.unfiltered().find((m) => m.db_id === id),
              getDraftForMessageReply: context.drafts.getDraftForMessage,
              onRecipientsChange: context.onRecipientsChange,
            }}
          >
            {/* Edge-to-edge on mobile/tablet: the message list carries its own
                  insets in-scroll and under-scrolls the floating chrome. */}
            <div class="size-full select-none overscroll-none overflow-hidden flex flex-col">
              {props.header}
              {props.actions}
              <div
                class="w-full flex-1 flex flex-col items-center overflow-hidden"
                ref={context.registerMessagesContainer}
              >
                <MessageList
                  initialLoadComplete={context.initialLoadComplete()}
                  markdownDomRef={(el) => {
                    navigation.setMarkdownDomRef(el);
                  }}
                  title={props.title}
                  underScrollsBottom={!replyInputInFlow()}
                  showMiddleMessages={showMiddleMessages()}
                  hiddenChipFocused={context.messages.hiddenChipFocused()}
                  allowRowHover={!keyboardSelecting()}
                  onHiddenChipFocus={() => {
                    armKeyboardPointer();
                    context.messages.setFocused(undefined);
                    context.messages.setHiddenChipFocused(true);
                  }}
                  onOpenMiddle={() => {
                    leaveHiddenChip();
                    setUserOpenedMiddle(true);
                  }}
                />
                <CustomScrollbar scrollContainer={context.messagesListRef} />
              </div>
              <Show when={isTouchDevice() && mobileBottomReplyMessage()}>
                {(lastMessage) => (
                  <BottomReplyButtons lastMessage={lastMessage()} />
                )}
              </Show>
              <Show when={isTouchDevice()}>
                <MobileEmailComposeDrawer
                  markdownDomRef={(el) => {
                    navigation.setMarkdownDomRef(el);
                  }}
                />
              </Show>
            </div>
          </EmailFormContextProvider>
        </Match>
      </Switch>
    </Show>
  );
}
