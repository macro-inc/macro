import { EmailComposeView } from '@app/features/email-compose/views/email-compose';
import { EmailFormContextProvider } from '@app/features/email-compose/views/email-form-context';
import { isPersonalMessage } from '@app/features/email-message/core/is-personal-message';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import type { JSX } from 'solid-js';
import { type Accessor, Match, Show, Switch } from 'solid-js';
import type {
  EmailThreadDependencies,
  EmailThreadHost,
} from '../context/email-thread-dependencies';
import { createThreadNavigation } from '../primitives/thread-navigation';
import { BottomReplyButtons } from './bottom-reply-buttons';
import { useEmailContext } from './email-thread-context';
import { MessageList } from './message-list';
import { MobileEmailComposeDrawer } from './mobile-email-compose-drawer';
import { useEmailThreadEnvironment } from './thread-environment';
export type EmailThreadViewProps = {
  title: string;
  threadId: Accessor<string>;
  dependencies: EmailThreadDependencies;
  host?: EmailThreadHost;
  header?: JSX.Element;
  actions?: JSX.Element;
};
export function EmailThreadView(props: EmailThreadViewProps) {
  const context = useEmailContext();
  const environment = useEmailThreadEnvironment();
  const deps = props.dependencies;
  const isTouchDevice = deps.isTouch;
  const navigation = createThreadNavigation(props, context, deps, props.host);
  const {
    showMiddleMessages,
    keyboardSelecting,
    armKeyboardPointer,
    leaveHiddenChip,
    setUserOpenedMiddle,
    emailReplyInfo,
    replyInputInFlow,
    mobileBottomReplyMessage,
  } = navigation;
  return (
    <Show when={!deps.viewerLoading()}>
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
                services={environment.compose}
                host={environment.composeHost}
                session={context}
                draftID={draft().db_id!}
              />
            </div>
          )}
        </Match>

        <Match when={true}>
          <EmailFormContextProvider
            dependencies={{
              viewerEmail: environment.compose.viewerEmail,
              inboxes: environment.compose.accounts.inboxes,
            }}
            formOptions={{
              getMessageByID: (id) =>
                context.messages.unfiltered().find((m) => m.db_id === id),
              getDraftForMessageReply: context.drafts.getDraftForMessage,
              onRecipientsChange: context.onRecipientsChange,
              isPersonalMessage: (message) =>
                isPersonalMessage(
                  message,
                  deps.viewerEmail(),
                  context.messages.personalSenders()
                ),
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
