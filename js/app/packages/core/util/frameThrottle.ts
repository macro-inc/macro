export const frameThrottle = <T extends (...args: any) => any>(
  callback: T
): ((...args: Parameters<T>) => void) & { cancel(): void } => {
  let requestId: number | undefined;

  let lastArgs: any[];

  const later = (context: any) => () => {
    requestId = undefined;
    callback.apply(context, lastArgs);
  };

  const throttled = function (
    this: ThisParameterType<T>,
    ...args: Parameters<T>
  ) {
    lastArgs = args;
    if (requestId == null) {
      requestId = requestAnimationFrame(later(this));
    }
  };

  throttled.cancel = () => {
    if (!requestId) return;
    cancelAnimationFrame(requestId);
    requestId = undefined;
  };

  return throttled;
};
