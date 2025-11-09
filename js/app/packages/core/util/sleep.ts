export function sleep(timeout: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      resolve();
    }, timeout);
  });
}
