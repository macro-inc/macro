import { EmailFormContextProvider } from '@app/features/email-compose/context/email-form-context';
import { observeDraftRestoration } from '@app/features/email-compose/primitives/draft-restoration';
import { EmailComposeView } from '@app/features/email-compose/views/email-compose';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { createScrollTopFade } from '@core/util/createScrollTopFade';
import type { JSX } from 'solid-js';
import { type Accessor, Match, Show, Switch } from 'solid-js';
import { EmailThreadTitle } from '../components/email-thread-title';
import type { EmailThreadHost } from '../context/email-thread-context';
import { useEmailThreadState } from '../context/email-thread-state-context';
import { useEmailThreadViewContext } from '../context/email-thread-view-context';
import { createThreadNavigation } from '../primitives/thread-navigation';
import { createThreadReplyArea } from '../primitives/thread-reply-area';
import { BottomReplyButtons } from './bottom-reply-buttons';
import { EmailParticipants } from './email-participants';
import { MessageList } from './message-list';
import { MobileEmailCompose } from './mobile-email-compose';
export type EmailThreadViewProps = {
  title: string;
  /** Host control after the subject's last word, in place of Copy subject. */
  titleTrailing?: JSX.Element;
  threadId: Accessor<string>;
  host?: EmailThreadHost;
  header?: JSX.Element;
  actions?: JSX.Element;
};
export function EmailThreadView(props: EmailThreadViewProps) {
  const context = useEmailThreadState();
  createScrollTopFade(context.messagesListRef);
  const viewContext = useEmailThreadViewContext();
  const threadContext = viewContext.thread;
  const isTouchDevice = threadContext.isTouch;
  observeDraftRestoration({
    storage: viewContext.compose.drafts,
    accepts: (change) =>
      change.threadId === props.threadId() && !!change.replyingToId,
    version: props.threadId,
    cancelPendingSave() {},
    setPending() {},
    restore: (draft) => {
      context.drafts.restoreDraftForMessage(draft);
      if (!draft.replying_to_id) return;
      if (isTouchDevice())
        context.mobileReplyComposer.openForMessage(draft.replying_to_id);
      else context.messages.setReplyingToMessageId(draft.replying_to_id);
    },
    reportError: viewContext.compose.notices.reportError,
  });
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
            // The compose view carries the mobile chrome insets itself, so
            // this branch only has to hand it the full frame.
            <div class="size-full">
              <EmailComposeView
                context={viewContext.compose}
                host={{
                  ...viewContext.composeHost,
                  goBack:
                    props.host?.returnToList ?? viewContext.composeHost?.goBack,
                }}
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
                  insets in-scroll and under-scrolls the floating chrome. On
                  every device persistent prompts wait rather than cover its
                  last attachments, reply bar and reply composer. */}
            <div
              class="size-full select-none overscroll-none overflow-hidden flex flex-col"
              data-holds-prompts
            >
              {props.header}
              {props.actions}
              {viewContext.rendering.renderOrganizationStatus?.({
                announceRead: context.isThreadMarkedRead,
              })}
              {/* Measure message gutters against the thread, excluding the side panel. */}
              <div
                class="@container w-full flex-1 flex flex-col items-center overflow-hidden"
                ref={context.registerMessagesContainer}
              >
                {/* Desktop keeps the subject, tags and participants still
                    while the messages scroll up under them. */}
                <Show when={!isTouchDevice() && props.title}>
                  {(title) => (
                    <div class="shrink-0 w-full flex justify-center">
                      <div class="macro-message-width macro-message-padding w-full pt-2 pb-3.5">
                        <EmailThreadTitle
                          onCopy={viewContext.copySubject}
                          title={title()}
                          copyReveal="hover"
                          trailing={props.titleTrailing}
                          class="text-2xl"
                        />
                        <div class="h-2" aria-hidden="true" />
                        {/* Bounded so a long expanded list scrolls instead of
                            crowding out the messages; the padding keeps focus
                            rings unclipped. */}
                        <div class="-m-1 max-h-34 overflow-y-auto p-1">
                          <EmailParticipants />
                        </div>
                      </div>
                    </div>
                  )}
                </Show>
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
                  <BottomReplyButtons
                    lastMessage={lastMessage()}
                    navigation={props.host?.listNavigation}
                  />
                )}
              </Show>
              <Show when={isTouchDevice()}>
                <MobileEmailCompose
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
