const PREFIX = '[pr-block:loading]';

export function logPrLoading(message: string, details?: unknown) {
  const time = Math.round(performance.now());
  if (details === undefined) {
    console.log(PREFIX, `${time}ms`, message);
    return;
  }
  console.log(PREFIX, `${time}ms`, message, details);
}
