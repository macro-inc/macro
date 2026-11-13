import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import type { EmailThreadListNavigation } from '@app/features/email-thread/context/email-thread-context';
import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import type { BlockTool } from '@components/app/block-tool';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel } from '@components/app/side-panel';
import { ListNavigationButtons } from '@components/app/split-layout/components/SplitHeader';
import { TOKENS } from '@core/hotkey/tokens';
import CheckBoldIcon from '@icon/system/bold/check-bold.svg?component-solid';
import CheckIcon from '@icon/system/regular/check.svg';
import EnvelopeSimpleIcon from '@icon/system/regular/envelope-simple.svg';
import EnvelopeSimpleOpenIcon from '@icon/system/regular/envelope-simple-open.svg';
import TaskIcon from '@icon/system/regular/list-checks.svg';
import { ButtonGroup } from '@ui';
import { type JSX, Show } from 'solid-js';
import type {
  EmailThreadControlState,
  EmailThreadMenuActions,
} from '../component/useEmailThreadTools';

/** The desktop title menu, in menu order. */
export function emailThreadMenu(actions: EmailThreadMenuActions): BlockTool[] {
  return [
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
  ];
}

function EmailThreadControls(props: EmailThreadControlState) {
  return (
    <>
      {props.reminder}
      {/* Read-state toggle. Viewing the thread marks it read, so it
            starts as Mark as unread; marking unread flips it to a bold
            accent closed envelope that re-marks the thread read. */}
      <Show when={props.isOwnThread}>
        <ButtonGroup.Button
          variant="ghost"
          aria-label={props.isUnread ? 'Mark as read' : 'Mark as unread'}
          tooltip={{
            content: props.isUnread ? 'Mark as read' : 'Mark as unread',
            hotkey: props.isUnread
              ? TOKENS.entity.action.markRead
              : TOKENS.entity.action.markUnread,
          }}
          size="icon-md"
          onClick={props.onToggleUnread}
          // Keep focus (and the hotkey scope cmd-K reads) in the thread
          // content: focusing the header would hide its commands.
          onMouseDown={(e) => e.preventDefault()}
        >
          <Show
            when={props.isUnread}
            fallback={<EnvelopeSimpleOpenIcon class="size-4" />}
          >
            <EnvelopeSimpleIcon class="size-4 text-accent" />
          </Show>
        </ButtonGroup.Button>
      </Show>
      <Show when={props.isOwnThread && props.canToggleDone}>
        <ButtonGroup.Button
          variant="ghost"
          aria-label={props.isDone ? 'Mark as not done' : 'Mark done'}
          tooltip={{
            content: props.isDone ? 'Mark as not done' : 'Mark done',
            hotkey: props.isDone
              ? TOKENS.entity.action.markNotDone
              : TOKENS.entity.action.markDone,
          }}
          size="icon-md"
          onClick={props.onToggleDone}
          // Same focus-preservation as the read-state toggle above.
          onMouseDown={(e) => e.preventDefault()}
        >
          <Show when={props.isDone} fallback={<CheckIcon class="size-4" />}>
            <CheckBoldIcon class="size-4 text-accent" />
          </Show>
        </ButtonGroup.Button>
      </Show>
    </>
  );
}

export function EmailThreadControlGroups(props: {
  controls: EmailThreadControlState;
  navigation?: EmailThreadListNavigation;
}) {
  return (
    <div class="flex items-center gap-2">
      <HeaderActionGroup label="Email actions" size="md">
        <EmailThreadControls {...props.controls} />
      </HeaderActionGroup>
      <Show when={props.navigation}>
        {(navigation) => (
          <HeaderActionGroup label="Item navigation" size="md">
            <ListNavigationButtons
              navigation={navigation()}
              size="md"
              class="gap-0"
            />
          </HeaderActionGroup>
        )}
      </Show>
    </div>
  );
}

/** The same desktop action groups in Mail and inline thread previews. */
export function EmailThreadHeaderActions(props: {
  controls?: JSX.Element;
  share?: JSX.Element;
}) {
  return (
    <div class="ml-auto flex shrink-0 items-center gap-2">
      {props.controls}
      <SidePanel.HeaderActionsOutlet />
      <Show when={props.share}>
        <HeaderActionGroup label="Sharing" size="md">
          {props.share}
        </HeaderActionGroup>
      </Show>
      <SidePanel.Toggle size="md" />
    </div>
  );
}

/** Ask Macro and Create task, shown before Share in a desktop thread header. */
export function EmailThreadActions(props: {
  title: string;
  onCreateTask: () => void;
}) {
  const context = useEmailThreadState();

  return (
    <SidePanel.HeaderActions>
      <HeaderActionGroup label="Actions" size="md">
        <Show when={context.thread()?.db_id}>
          {(id) => (
            <AskMacroButton
              grouped
              size="icon-md"
              entity={{ type: 'email', id: id(), name: props.title }}
            />
          )}
        </Show>
        <Show when={context.thread()?.db_id}>
          <HeaderActionButton
            grouped
            size="icon-md"
            tooltip="Create task"
            label="Create task"
            onClick={props.onCreateTask}
            icon={<TaskIcon class="size-3.5 shrink-0 pointer-events-none" />}
          />
        </Show>
      </HeaderActionGroup>
    </SidePanel.HeaderActions>
  );
}
