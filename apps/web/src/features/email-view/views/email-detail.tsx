import { ViewShell } from '@app/components/view-shell';
import {
  type EmailThreadToolsOptions,
  useEmailThreadTools,
} from '@block-email/component/useEmailThreadTools';
import {
  type EmailBlockViewProps,
  EmailThreadHostView,
} from '@block-email/EmailThreadHostView';
import {
  EmailThreadActions,
  EmailThreadControlGroups,
  EmailThreadHeaderActions,
  emailThreadMenu,
} from '@block-email/views/email-thread-parts';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { getPermissions } from '@core/component/SharePermissions';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import { Button } from '@ui';
import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

/**
 * Where the title menu sits after the subject's last word. It unsets itself on
 * unmount so a standalone draft, which has no subject line, gets the menu in
 * the header instead.
 */
function TitleMenuMount(props: {
  ref: (element: HTMLElement | undefined) => void;
}) {
  onCleanup(() => props.ref(undefined));
  return <span ref={props.ref} class="ml-1.5 inline-flex align-middle" />;
}

/** The thread's title menu and header controls, which need the loaded thread. */
function EmailDetailHeader(
  props: EmailThreadToolsOptions & {
    titleMenuMount: HTMLElement | undefined;
    controlsMount: HTMLDivElement | undefined;
    onEmailReminderSaved: () => void | Promise<void>;
  }
) {
  const { emailEntity, permissions, actions, controls } =
    useEmailThreadTools(props);
  return (
    <>
      <Show when={props.titleMenuMount} keyed>
        {(mount) => (
          <Portal mount={mount} ref={(div) => (div.style.display = 'contents')}>
            <SplitFileMenu
              id={props.id}
              itemType="email"
              entityKind="email"
              name={props.title}
              entity={emailEntity()}
              permissions={permissions()}
              ops={[]}
              tools={emailThreadMenu(actions)}
              onEmailReminderSaved={props.onEmailReminderSaved}
            />
          </Portal>
        )}
      </Show>
      <Show when={props.controlsMount}>
        {(mount) => (
          <Portal mount={mount()}>
            <EmailThreadControlGroups
              controls={controls}
              navigation={props.listNavigation}
            />
          </Portal>
        )}
      </Show>
    </>
  );
}

/**
 * A thread in desktop Mail: Back (unless the reading pane shows the list
 * beside it), the title menu, the thread controls and Share above the thread.
 */
export function EmailDetail(
  props: EmailBlockViewProps & {
    listNavigation: NonNullable<EmailThreadToolsOptions['listNavigation']>;
    /** The reading pane shows the list beside the thread, so no Back. */
    inReadingPane: boolean;
    hotkeyScope: string;
    onClose: () => void;
    onEmailReminderSaved: () => Promise<void>;
    /** Wraps the thread in the entry's load gate and focus target. */
    frame: (thread: () => JSX.Element) => JSX.Element;
  }
) {
  const [controlsMount, setControlsMount] = createSignal<HTMLDivElement>();
  const [subjectMenuMount, setSubjectMenuMount] = createSignal<HTMLElement>();
  const [headerMenuMount, setHeaderMenuMount] = createSignal<HTMLElement>();
  const openShare = useShareModal(() => {
    const thread = props.source.thread();
    if (!thread) return;
    return {
      id: props.threadId(),
      blockAlias: 'email',
      itemType: 'email',
      name: props.title,
      userPermissions: getPermissions(thread.access_level),
    };
  });

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <ViewShell.TopBar>
        {/* The subject sits atop the thread, so the header only goes
            back; the reading pane already shows the list beside it. */}
        <Show when={!props.inReadingPane}>
          <Button
            variant="ghost"
            size="icon-md"
            tooltip="Back"
            aria-label="Back"
            onClick={() => props.onClose()}
          >
            <ArrowLeftIcon class="size-4" />
          </Button>
        </Show>
        <div ref={setHeaderMenuMount} class="flex items-center" />
        <EmailThreadHeaderActions
          controls={<div ref={setControlsMount} class="flex items-center" />}
          share={
            <Show when={ENABLE_EMAIL_SHARING}>
              <ShareTrigger
                size="md"
                onClick={openShare}
                id={props.threadId()}
                blockType="email"
                hotkeyScope={props.hotkeyScope}
              />
            </Show>
          }
        />
      </ViewShell.TopBar>
      {props.frame(() => (
        <EmailThreadHostView
          title={props.title}
          titleTrailing={<TitleMenuMount ref={setSubjectMenuMount} />}
          threadId={props.threadId}
          source={props.source}
          host={props.host}
          chrome={({ createTask, createEvent, canCreateEvent }) => (
            <EmailDetailHeader
              onEmailReminderSaved={props.onEmailReminderSaved}
              id={props.threadId()}
              title={props.title}
              onCreateTask={createTask}
              onCreateEvent={createEvent}
              canCreateEvent={canCreateEvent}
              onMarkedUnread={props.onClose}
              onDeleted={props.onClose}
              listNavigation={props.listNavigation}
              titleMenuMount={subjectMenuMount() ?? headerMenuMount()}
              controlsMount={controlsMount()}
            />
          )}
          actions={({ createTask }) => (
            <EmailThreadActions title={props.title} onCreateTask={createTask} />
          )}
        />
      ))}
    </div>
  );
}
