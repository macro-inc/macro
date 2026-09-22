import type {
  SplitRouterBeforeLeaveContext,
  SplitRouterBeforeLeaveHandler,
  SplitRouterEvent,
} from './types';

export type SplitRouterBeforeLeaveRun = boolean | Promise<boolean>;

export function runSplitRouterBeforeLeave<TSplitId>(
  handlers: Iterable<SplitRouterBeforeLeaveHandler<TSplitId>>,
  event: SplitRouterEvent<TSplitId>
): SplitRouterBeforeLeaveRun {
  let defaultPrevented = false;
  let retried = false;
  let resume: (() => void) | undefined;

  const context: SplitRouterBeforeLeaveContext<TSplitId> = {
    ...event,
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault() {
      defaultPrevented = true;
    },
    retry() {
      retried = true;
      resume?.();
    },
  };

  for (const handler of [...handlers]) {
    if (event.request.signal.aborted) return false;
    try {
      handler(context);
    } catch (error) {
      console.error('Split router before-leave handler failed', error);
    }
  }

  if (event.request.signal.aborted) return false;
  if (!defaultPrevented || retried) return true;

  return new Promise<boolean>((resolve) => {
    const finish = (accepted: boolean) => {
      event.request.signal.removeEventListener('abort', onAbort);
      resume = undefined;
      resolve(accepted);
    };
    const onAbort = () => finish(false);

    resume = () => finish(true);
    event.request.signal.addEventListener('abort', onAbort, { once: true });

    if (event.request.signal.aborted) onAbort();
    else if (retried) resume();
  });
}
