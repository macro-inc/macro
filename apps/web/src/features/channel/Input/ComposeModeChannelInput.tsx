import { isMobile } from '@core/mobile/isMobile';
import { isPlatform } from '@core/util/platform';
import { makePersisted } from '@solid-primitives/storage';
import { cn } from '@ui';
import {
  type Accessor,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  splitProps,
} from 'solid-js';
import { ChannelInput, type ChannelInputProps } from './ChannelInput';
import { ComposeModeSwitch } from './ComposeModeSwitch';
import { type ChannelComposeMode, coerceComposeMode } from './compose-mode';
import { EventComposer, type EventComposerSendPayload } from './EventComposer';
import { createEventModeAvailability } from './event-mode-availability';
import { Input } from './Input';
import { TaskComposer, type TaskComposerSendPayload } from './TaskComposer';
import type { InputHandle } from './types';
import type { InputComposePersistence } from './utils/persistence';

/** Enables the event compose mode on a channel input. */
export type ChannelInputEventMode = {
  /** Channel hosting the input; created events link back to it. */
  channelId: string;
  /** Called after the event composer creates a calendar event. */
  onSendEvent: (event: EventComposerSendPayload) => void;
};

/** Props for a full channel input with message, task, and event modes. */
export type ComposeModeChannelInputProps = Omit<
  ChannelInputProps,
  'children' | 'collapseOnFocusOut' | 'renderContent'
> & {
  /** Called after the task composer creates a task. */
  onSendTask: (task: TaskComposerSendPayload) => void;
  /**
   * Event compose mode configuration. Presence is read once at mount;
   * without it the Event switch never shows. Even with it, the switch only
   * shows while the calendar UI is available to the viewer.
   */
  eventMode?: ChannelInputEventMode;
  /** Persistence keys for the composer drafts and selected input mode. */
  composePersistence?: InputComposePersistence;
};

function MessageModeActions(props: { modeSwitches: JSX.Element }) {
  return (
    <Show
      when={isPlatform('ios')}
      fallback={
        <Input.Actions>
          <Input.Actions.Left>
            <Input.AttachFilesAction />
            <Input.ToggleFormatAction />
            {props.modeSwitches}
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
 * Composes the message-only ChannelInput with the task and calendar-event
 * composers for full channel and DM views. Import this module directly;
 * exporting it from the general Input barrel would pull the task/entity and
 * calendar graphs into thread inputs.
 */
export function ComposeModeChannelInput(props: ComposeModeChannelInputProps) {
  const [local, inputProps] = splitProps(props, [
    'autofocus',
    'onReady',
    'onSendTask',
    'eventMode',
    'composePersistence',
  ]);

  const canUseComposeModes = () => !isPlatform('ios') && !isMobile();
  // Presence of the event mode config is a mount-time decision so the
  // calendar availability queries only exist for hosts that opted in.
  const eventModeConfig = local.eventMode;
  const eventModeAvailable: Accessor<boolean> | undefined = eventModeConfig
    ? createEventModeAvailability()
    : undefined;
  const canUseTaskMode = () => canUseComposeModes();
  const canUseEventMode = () =>
    canUseComposeModes() && (eventModeAvailable?.() ?? false);

  const modeSignal = createSignal<ChannelComposeMode>('message');
  const [requestedModeRaw, setRequestedMode] = local.composePersistence
    ? makePersisted(modeSignal, { name: local.composePersistence.modeKey })
    : modeSignal;
  const requestedMode = () => coerceComposeMode(requestedModeRaw());
  const restoredMode = requestedMode();
  const [taskComposerMounted, setTaskComposerMounted] = createSignal(
    restoredMode === 'task'
  );
  const [eventComposerMounted, setEventComposerMounted] = createSignal(
    restoredMode === 'event'
  );
  const anyComposerMounted = () =>
    taskComposerMounted() || eventComposerMounted();

  // The presented face: a requested alternate face falls back to the plain
  // message input wherever it cannot be used (touch devices, calendar UI
  // unavailable).
  const mode = (): ChannelComposeMode => {
    const requested = requestedMode();
    if (requested === 'task' && canUseTaskMode()) return 'task';
    if (requested === 'event' && canUseEventMode()) return 'event';
    return 'message';
  };

  let messageInputHandle: InputHandle | undefined;
  let morphWrapperEl: HTMLDivElement | undefined;
  let morphContentEl: HTMLDivElement | undefined;
  const [morphHeight, setMorphHeight] = createSignal<number>();
  let morphTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(morphTimer));

  const setMode = (next: ChannelComposeMode) => {
    if (next === requestedMode()) return;
    if (next === 'task') setTaskComposerMounted(true);
    if (next === 'event') setEventComposerMounted(true);

    const from = morphWrapperEl?.offsetHeight;
    setRequestedMode(next);
    if (next === 'message') messageInputHandle?.focus();
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

  // Each face's footer shows every available mode pill (its own checked),
  // so any face can switch straight into any other.
  const modeSwitches = (current: ChannelComposeMode) => (
    <>
      <Show when={canUseTaskMode()}>
        <ComposeModeSwitch
          label="Task"
          checked={current === 'task'}
          onChange={(checked) => setMode(checked ? 'task' : 'message')}
        />
      </Show>
      <Show when={canUseEventMode()}>
        <ComposeModeSwitch
          label="Event"
          checked={current === 'event'}
          onChange={(checked) => setMode(checked ? 'event' : 'message')}
        />
      </Show>
    </>
  );

  const handleTaskSend = (task: TaskComposerSendPayload) => {
    local.onSendTask(task);
    setMode('message');
  };

  const handleEventSend = (event: EventComposerSendPayload) => {
    eventModeConfig?.onSendEvent(event);
    setMode('message');
  };

  const setMessageInputHandle = (handle: InputHandle) => {
    messageInputHandle = handle;
    local.onReady?.(handle);
  };

  return (
    <ChannelInput
      {...inputProps}
      autofocus={restoredMode !== 'message' ? false : local.autofocus}
      collapseOnFocusOut={mode() === 'message'}
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
                mode() !== 'message' && 'hidden',
                anyComposerMounted() &&
                  'animate-[dialog-fullscreen-open_200ms_ease-out]'
              )}
              data-input-face="message"
            >
              {messageFace}
            </div>
            <Show when={taskComposerMounted()}>
              <div
                class={cn(
                  mode() !== 'task' && 'hidden',
                  'animate-[dialog-fullscreen-open_200ms_ease-out]'
                )}
                data-input-face="task"
              >
                <TaskComposer
                  active={mode() === 'task'}
                  autofocus={
                    restoredMode === 'task' ? (local.autofocus ?? true) : true
                  }
                  draftPersistenceKey={local.composePersistence?.taskDraftKey}
                  modeSwitch={modeSwitches('task')}
                  onSend={handleTaskSend}
                />
              </div>
            </Show>
            <Show when={eventComposerMounted() && eventModeConfig}>
              {(eventMode) => (
                <div
                  class={cn(
                    mode() !== 'event' && 'hidden',
                    'animate-[dialog-fullscreen-open_200ms_ease-out]'
                  )}
                  data-input-face="event"
                >
                  <EventComposer
                    active={mode() === 'event'}
                    channelId={eventMode().channelId}
                    participants={inputProps.participants}
                    autofocus={
                      restoredMode === 'event'
                        ? (local.autofocus ?? true)
                        : true
                    }
                    draftPersistenceKey={
                      local.composePersistence?.eventDraftKey
                    }
                    modeSwitch={modeSwitches('event')}
                    onSend={handleEventSend}
                  />
                </div>
              )}
            </Show>
          </div>
        </div>
      )}
    >
      <MessageModeActions modeSwitches={modeSwitches('message')} />
    </ChannelInput>
  );
}
