import { isMobile } from '@core/mobile/isMobile';
import { isPlatform } from '@core/util/platform';
import { makePersisted } from '@solid-primitives/storage';
import { cn } from '@ui';
import { createSignal, onCleanup, Show, splitProps } from 'solid-js';
import { ChannelInput, type ChannelInputProps } from './ChannelInput';
import { Input } from './Input';
import { TaskComposer, type TaskComposerSendPayload } from './TaskComposer';
import { TaskModeSwitch } from './TaskModeSwitch';
import type { InputHandle } from './types';
import type { InputTaskPersistence } from './utils/persistence';

/** Props for a full channel input with message and task composition modes. */
export type TaskModeChannelInputProps = Omit<
  ChannelInputProps,
  'children' | 'collapseOnFocusOut' | 'renderContent'
> & {
  /** Called after the task composer creates a task. */
  onSendTask: (task: TaskComposerSendPayload) => void;
  /** Persistence keys for the task draft and selected input mode. */
  taskPersistence?: InputTaskPersistence;
};

function MessageModeActions(props: {
  canUseTaskMode: boolean;
  onEnterTaskMode: () => void;
}) {
  return (
    <Show
      when={isPlatform('ios')}
      fallback={
        <Input.Actions>
          <Input.Actions.Left>
            <Input.AttachFilesAction />
            <Input.ToggleFormatAction />
            <Show when={props.canUseTaskMode}>
              <TaskModeSwitch
                checked={false}
                onChange={props.onEnterTaskMode}
              />
            </Show>
          </Input.Actions.Left>
          <Input.Actions.Right>
            <Input.SendAction />
          </Input.Actions.Right>
        </Input.Actions>
      }
    >
      <Input.Actions>
        <Input.Actions.Left>
          <Input.AttachNativeMediaAction />
          <Input.ToggleFormatAction />
        </Input.Actions.Left>
        <Input.Actions.Right>
          <Input.SendAction />
        </Input.Actions.Right>
      </Input.Actions>
    </Show>
  );
}

/**
 * Composes the message-only ChannelInput with the task composer for full
 * channel and DM views. Import this module directly; exporting it from the
 * general Input barrel would pull the task/entity graph into thread inputs.
 */
export function TaskModeChannelInput(props: TaskModeChannelInputProps) {
  const [local, inputProps] = splitProps(props, [
    'autofocus',
    'onReady',
    'onSendTask',
    'taskPersistence',
  ]);

  const canUseTaskMode = () => !isPlatform('ios') && !isMobile();
  const taskModeSignal = createSignal(false);
  const [taskModeRequested, setTaskModeRequested] = local.taskPersistence
    ? makePersisted(taskModeSignal, { name: local.taskPersistence.modeKey })
    : taskModeSignal;
  const taskModeRestored = taskModeRequested() === true;
  const [taskComposerMounted, setTaskComposerMounted] =
    createSignal(taskModeRestored);
  const isTaskMode = () => canUseTaskMode() && taskModeRequested();

  let messageInputHandle: InputHandle | undefined;
  let morphWrapperEl: HTMLDivElement | undefined;
  let morphContentEl: HTMLDivElement | undefined;
  const [morphHeight, setMorphHeight] = createSignal<number>();
  let morphTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(morphTimer));

  const setTaskMode = (task: boolean) => {
    if (task === taskModeRequested()) return;
    if (task) setTaskComposerMounted(true);

    const from = morphWrapperEl?.offsetHeight;
    setTaskModeRequested(task);
    if (!task) messageInputHandle?.focus();
    if (from === undefined) return;

    setMorphHeight(from);
    requestAnimationFrame(() => {
      const to = morphContentEl?.offsetHeight;
      if (to === undefined) return;
      setMorphHeight(to);
      clearTimeout(morphTimer);
      morphTimer = setTimeout(() => setMorphHeight(undefined), 350);
    });
  };

  const handleTaskSend = (task: TaskComposerSendPayload) => {
    local.onSendTask(task);
    setTaskMode(false);
  };

  const setMessageInputHandle = (handle: InputHandle) => {
    messageInputHandle = handle;
    local.onReady?.(handle);
  };

  return (
    <ChannelInput
      {...inputProps}
      autofocus={taskModeRestored ? false : local.autofocus}
      collapseOnFocusOut={!isTaskMode()}
      onReady={setMessageInputHandle}
      renderContent={(messageFace) => (
        <div
          ref={(el) => {
            morphWrapperEl = el;
          }}
          class={cn(
            morphHeight() !== undefined &&
              'overflow-hidden transition-[height] duration-300 ease-in-out'
          )}
          style={{
            height:
              morphHeight() !== undefined ? `${morphHeight()}px` : undefined,
          }}
        >
          <div
            ref={(el) => {
              morphContentEl = el;
            }}
          >
            <div
              class={cn(
                isTaskMode() && 'hidden',
                taskComposerMounted() &&
                  'animate-[dialog-fullscreen-open_200ms_ease-out]'
              )}
              data-input-face="message"
            >
              {messageFace}
            </div>
            <Show when={taskComposerMounted()}>
              <div
                class={cn(
                  !isTaskMode() && 'hidden',
                  'animate-[dialog-fullscreen-open_200ms_ease-out]'
                )}
                data-input-face="task"
              >
                <TaskComposer
                  active={isTaskMode()}
                  autofocus={
                    taskModeRestored ? (local.autofocus ?? true) : true
                  }
                  draftPersistenceKey={local.taskPersistence?.draftKey}
                  modeSwitch={
                    <TaskModeSwitch
                      checked={true}
                      onChange={() => setTaskMode(false)}
                    />
                  }
                  onSend={handleTaskSend}
                />
              </div>
            </Show>
          </div>
        </div>
      )}
    >
      <MessageModeActions
        canUseTaskMode={canUseTaskMode()}
        onEnterTaskMode={() => setTaskMode(true)}
      />
    </ChannelInput>
  );
}
