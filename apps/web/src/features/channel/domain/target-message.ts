import { match } from 'ts-pattern';

export type Target = {
  messageId: string;
  replyId?: string;
};

export type Control =
  | { t: 'idle' }
  | { t: 'loading'; target: Target }
  | { t: 'awaiting-viewport'; target: Target }
  | { t: 'scrolling'; target: Target; rootDone: boolean }
  | { t: 'flashing'; target: Target };

export type MachineState = {
  control: Control;
  loadAround: string | undefined;
};

export type TargetEvent =
  | {
      t: 'navigate';
      messageId: string;
      replyId?: string;
      targetLoaded: boolean;
    }
  | { t: 'target-loaded' }
  | { t: 'viewport-ready' }
  | { t: 'root-scroll-done'; messageId: string }
  | { t: 'reply-scroll-done'; messageId: string; replyId: string }
  | { t: 'flash-elapsed'; messageId: string }
  | { t: 'release'; messageId: string }
  | { t: 'pagination-restored' }
  | { t: 'reset' };

export type Command =
  | { t: 'schedule-flash'; messageId: string }
  | { t: 'cancel-flash' }
  | { t: 'restore-default-pagination'; loadAround: string };

export type Transition = {
  state: MachineState;
  commands: Command[];
};

export const idleState: MachineState = {
  control: { t: 'idle' },
  loadAround: undefined,
};

export function makeTarget(messageId: string, replyId?: string): Target {
  return replyId === undefined ? { messageId } : { messageId, replyId };
}

export function initialState(input: {
  messageId?: string;
  replyId?: string;
}): MachineState {
  if (!input.messageId) return idleState;
  return {
    control: {
      t: 'loading',
      target: makeTarget(input.messageId, input.replyId),
    },
    loadAround: input.messageId,
  };
}

function controlTarget(control: Control): Target | undefined {
  return control.t === 'idle' ? undefined : control.target;
}

export function activeTargetMessageId(state: MachineState): string | undefined {
  return controlTarget(state.control)?.messageId;
}

export function activeTargetMessageReplyId(
  state: MachineState
): string | undefined {
  return controlTarget(state.control)?.replyId;
}

export function loadAroundMessageId(state: MachineState): string | undefined {
  return state.loadAround;
}

export function pendingScrollTargetId(state: MachineState): string | undefined {
  const { control } = state;
  if (control.t === 'loading' || control.t === 'awaiting-viewport') {
    return control.target.messageId;
  }
  if (control.t === 'scrolling' && !control.rootDone) {
    return control.target.messageId;
  }
  return undefined;
}

export function pendingTargetReplyId(state: MachineState): string | undefined {
  const { control } = state;
  if (
    control.t === 'loading' ||
    control.t === 'awaiting-viewport' ||
    control.t === 'scrolling'
  ) {
    return control.target.replyId;
  }
  return undefined;
}

function isSameTargetPending(
  state: MachineState,
  messageId: string,
  replyId?: string
): boolean {
  const target = controlTarget(state.control);
  if (!target) return false;
  if (target.messageId !== messageId || target.replyId !== replyId) {
    return false;
  }
  return pendingScrollTargetId(state) === messageId;
}

function unchanged(state: MachineState): Transition {
  return { state, commands: [] };
}

function reduceNavigate(
  state: MachineState,
  event: Extract<TargetEvent, { t: 'navigate' }>
): Transition {
  if (isSameTargetPending(state, event.messageId, event.replyId)) {
    return unchanged(state);
  }

  const target = makeTarget(event.messageId, event.replyId);
  if (!event.targetLoaded) {
    return {
      state: {
        control: { t: 'loading', target },
        loadAround: event.messageId,
      },
      commands: [{ t: 'cancel-flash' }],
    };
  }

  return {
    state: {
      control: { t: 'awaiting-viewport', target },
      loadAround: state.loadAround,
    },
    commands: [{ t: 'cancel-flash' }],
  };
}

function reduceRelease(state: MachineState, messageId: string): Transition {
  const target = controlTarget(state.control);
  if (!target || target.messageId !== messageId) return unchanged(state);
  return {
    state: { control: { t: 'idle' }, loadAround: state.loadAround },
    commands: [{ t: 'cancel-flash' }],
  };
}

function reduceFlashElapsed(
  state: MachineState,
  messageId: string
): Transition {
  if (state.control.t !== 'flashing') return unchanged(state);
  if (state.control.target.messageId !== messageId) return unchanged(state);
  return {
    state: { control: { t: 'idle' }, loadAround: state.loadAround },
    commands: [],
  };
}

function reduceTargetLoaded(state: MachineState): Transition {
  if (state.control.t !== 'loading') return unchanged(state);
  return {
    state: {
      control: { t: 'awaiting-viewport', target: state.control.target },
      loadAround: state.loadAround,
    },
    commands: [],
  };
}

function reduceViewportReady(state: MachineState): Transition {
  if (state.control.t !== 'awaiting-viewport') return unchanged(state);
  const { target } = state.control;
  const commands: Command[] = [];
  if (state.loadAround) {
    commands.push({
      t: 'restore-default-pagination',
      loadAround: state.loadAround,
    });
  }
  return {
    state: {
      control: {
        t: 'scrolling',
        target,
        rootDone: target.replyId != null,
      },
      loadAround: state.loadAround,
    },
    commands,
  };
}

function enterFlashing(state: MachineState, target: Target): Transition {
  return {
    state: { control: { t: 'flashing', target }, loadAround: state.loadAround },
    commands: [{ t: 'schedule-flash', messageId: target.messageId }],
  };
}

function reduceRootScrollDone(
  state: MachineState,
  messageId: string
): Transition {
  const { control } = state;
  if (control.t === 'idle' || control.t === 'flashing') {
    return unchanged(state);
  }
  if (control.target.messageId !== messageId) return unchanged(state);

  if (control.t === 'loading' || control.t === 'awaiting-viewport') {
    if (control.target.replyId) {
      return {
        state: {
          control: { t: 'scrolling', target: control.target, rootDone: true },
          loadAround: state.loadAround,
        },
        commands: [],
      };
    }
    return enterFlashing(state, control.target);
  }

  if (control.rootDone) return unchanged(state);
  if (control.target.replyId) {
    return {
      state: {
        control: { t: 'scrolling', target: control.target, rootDone: true },
        loadAround: state.loadAround,
      },
      commands: [],
    };
  }
  return enterFlashing(state, control.target);
}

function reduceReplyScrollDone(
  state: MachineState,
  messageId: string,
  replyId: string
): Transition {
  if (state.control.t !== 'scrolling') return unchanged(state);
  if (state.control.target.messageId !== messageId) return unchanged(state);
  if (state.control.target.replyId !== replyId) return unchanged(state);
  return enterFlashing(state, state.control.target);
}

export function reduce(state: MachineState, event: TargetEvent): Transition {
  return match(event)
    .with({ t: 'navigate' }, (next) => reduceNavigate(state, next))
    .with({ t: 'target-loaded' }, () => reduceTargetLoaded(state))
    .with({ t: 'viewport-ready' }, () => reduceViewportReady(state))
    .with({ t: 'root-scroll-done' }, (next) =>
      reduceRootScrollDone(state, next.messageId)
    )
    .with({ t: 'reply-scroll-done' }, (next) =>
      reduceReplyScrollDone(state, next.messageId, next.replyId)
    )
    .with({ t: 'flash-elapsed' }, (next) =>
      reduceFlashElapsed(state, next.messageId)
    )
    .with({ t: 'release' }, (next) => reduceRelease(state, next.messageId))
    .with({ t: 'pagination-restored' }, () => ({
      state: { control: state.control, loadAround: undefined },
      commands: [],
    }))
    .with({ t: 'reset' }, () => ({
      state: idleState,
      commands: [{ t: 'cancel-flash' } as const],
    }))
    .exhaustive();
}
