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

type Reduction = {
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

function unchanged(state: MachineState): Reduction {
  return { state, commands: [] };
}

function changed(state: MachineState, commands: Command[] = []): Reduction {
  return { state, commands };
}

function controlTarget(control: Control): Target | undefined {
  return match(control)
    .with({ t: 'idle' }, () => undefined)
    .with({ t: 'loading' }, ({ target }) => target)
    .with({ t: 'awaiting-viewport' }, ({ target }) => target)
    .with({ t: 'scrolling' }, ({ target }) => target)
    .with({ t: 'flashing' }, ({ target }) => target)
    .exhaustive();
}

export function initialState(input: {
  messageId?: string;
  replyId?: string;
  targetLoaded?: boolean;
}): MachineState {
  if (input.messageId === undefined) return idleState;

  const target = makeTarget(input.messageId, input.replyId);
  return {
    control: input.targetLoaded
      ? { t: 'awaiting-viewport', target }
      : { t: 'loading', target },
    loadAround: input.messageId,
  };
}

function reduceNavigate(
  state: MachineState,
  event: Extract<TargetEvent, { t: 'navigate' }>
): Reduction {
  const currentTarget = controlTarget(state.control);
  const sameTarget =
    currentTarget?.messageId === event.messageId &&
    currentTarget?.replyId === event.replyId;
  if (sameTarget && pendingScrollTargetId(state) === event.messageId) {
    return unchanged(state);
  }

  const target = makeTarget(event.messageId, event.replyId);
  if (!event.targetLoaded) {
    return changed(
      {
        control: { t: 'loading', target },
        loadAround: event.messageId,
      },
      [{ t: 'cancel-flash' }]
    );
  }

  return changed(
    {
      control: { t: 'awaiting-viewport', target },
      loadAround: state.loadAround,
    },
    [{ t: 'cancel-flash' }]
  );
}

function reduceTargetLoaded(state: MachineState): Reduction {
  return match(state.control)
    .with({ t: 'idle' }, () => unchanged(state))
    .with({ t: 'loading' }, ({ target }) =>
      changed({
        control: { t: 'awaiting-viewport', target },
        loadAround: state.loadAround,
      })
    )
    .with({ t: 'awaiting-viewport' }, () => unchanged(state))
    .with({ t: 'scrolling' }, () => unchanged(state))
    .with({ t: 'flashing' }, () => unchanged(state))
    .exhaustive();
}

function reduceViewportReady(state: MachineState): Reduction {
  return match(state.control)
    .with({ t: 'idle' }, () => unchanged(state))
    .with({ t: 'loading' }, () => unchanged(state))
    .with({ t: 'awaiting-viewport' }, ({ target }) =>
      changed(
        {
          control: {
            t: 'scrolling',
            target,
            rootDone: target.replyId !== undefined,
          },
          loadAround: state.loadAround,
        },
        state.loadAround === undefined
          ? []
          : [
              {
                t: 'restore-default-pagination',
                loadAround: state.loadAround,
              },
            ]
      )
    )
    .with({ t: 'scrolling' }, () => unchanged(state))
    .with({ t: 'flashing' }, () => unchanged(state))
    .exhaustive();
}

function reduceRootScrollDone(
  state: MachineState,
  event: Extract<TargetEvent, { t: 'root-scroll-done' }>
): Reduction {
  return match(state.control)
    .with({ t: 'idle' }, () => unchanged(state))
    .with({ t: 'loading' }, () => unchanged(state))
    .with({ t: 'awaiting-viewport' }, () => unchanged(state))
    .with({ t: 'scrolling' }, ({ target }) => {
      if (
        target.replyId !== undefined ||
        target.messageId !== event.messageId
      ) {
        return unchanged(state);
      }

      return changed(
        {
          control: { t: 'flashing', target },
          loadAround: state.loadAround,
        },
        [{ t: 'schedule-flash', messageId: target.messageId }]
      );
    })
    .with({ t: 'flashing' }, () => unchanged(state))
    .exhaustive();
}

function reduceReplyScrollDone(
  state: MachineState,
  event: Extract<TargetEvent, { t: 'reply-scroll-done' }>
): Reduction {
  return match(state.control)
    .with({ t: 'idle' }, () => unchanged(state))
    .with({ t: 'loading' }, () => unchanged(state))
    .with({ t: 'awaiting-viewport' }, () => unchanged(state))
    .with({ t: 'scrolling' }, ({ target }) => {
      if (
        target.messageId !== event.messageId ||
        target.replyId !== event.replyId
      ) {
        return unchanged(state);
      }

      return changed(
        {
          control: { t: 'flashing', target },
          loadAround: state.loadAround,
        },
        [{ t: 'schedule-flash', messageId: target.messageId }]
      );
    })
    .with({ t: 'flashing' }, () => unchanged(state))
    .exhaustive();
}

function reduceFlashElapsed(
  state: MachineState,
  event: Extract<TargetEvent, { t: 'flash-elapsed' }>
): Reduction {
  return match(state.control)
    .with({ t: 'idle' }, () => unchanged(state))
    .with({ t: 'loading' }, () => unchanged(state))
    .with({ t: 'awaiting-viewport' }, () => unchanged(state))
    .with({ t: 'scrolling' }, () => unchanged(state))
    .with({ t: 'flashing' }, ({ target }) =>
      target.messageId === event.messageId
        ? changed({ control: { t: 'idle' }, loadAround: state.loadAround })
        : unchanged(state)
    )
    .exhaustive();
}

function reduceRelease(
  state: MachineState,
  event: Extract<TargetEvent, { t: 'release' }>
): Reduction {
  const target = controlTarget(state.control);
  if (target?.messageId !== event.messageId) return unchanged(state);

  return changed({ control: { t: 'idle' }, loadAround: state.loadAround }, [
    { t: 'cancel-flash' },
  ]);
}

export function reduce(state: MachineState, event: TargetEvent): Reduction {
  return match(event)
    .with({ t: 'navigate' }, (next) => reduceNavigate(state, next))
    .with({ t: 'target-loaded' }, () => reduceTargetLoaded(state))
    .with({ t: 'viewport-ready' }, () => reduceViewportReady(state))
    .with({ t: 'root-scroll-done' }, (next) =>
      reduceRootScrollDone(state, next)
    )
    .with({ t: 'reply-scroll-done' }, (next) =>
      reduceReplyScrollDone(state, next)
    )
    .with({ t: 'flash-elapsed' }, (next) => reduceFlashElapsed(state, next))
    .with({ t: 'release' }, (next) => reduceRelease(state, next))
    .with({ t: 'pagination-restored' }, () =>
      changed({ control: state.control, loadAround: undefined })
    )
    .with({ t: 'reset' }, () => changed(idleState, [{ t: 'cancel-flash' }]))
    .exhaustive();
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
  return match(state.control)
    .with({ t: 'idle' }, () => undefined)
    .with({ t: 'loading' }, ({ target }) => target.messageId)
    .with({ t: 'awaiting-viewport' }, ({ target }) => target.messageId)
    .with({ t: 'scrolling', rootDone: false }, ({ target }) => target.messageId)
    .with({ t: 'scrolling', rootDone: true }, () => undefined)
    .with({ t: 'flashing' }, () => undefined)
    .exhaustive();
}

export function pendingTargetReplyId(state: MachineState): string | undefined {
  return match(state.control)
    .with({ t: 'idle' }, () => undefined)
    .with({ t: 'loading' }, ({ target }) => target.replyId)
    .with({ t: 'awaiting-viewport' }, ({ target }) => target.replyId)
    .with({ t: 'scrolling' }, ({ target }) => target.replyId)
    .with({ t: 'flashing' }, () => undefined)
    .exhaustive();
}
