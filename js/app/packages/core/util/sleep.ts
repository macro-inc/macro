export function sleep(timeout: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      resolve();
    }, timeout);
  });
}

export async function waitForFrames(n: number) {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );
  }
}
