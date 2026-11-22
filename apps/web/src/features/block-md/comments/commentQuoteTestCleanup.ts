/** Test-only resource cleanup; never replace the original assertion/opaque cause. */
export async function finishQuoteControl(
  primary: { error: unknown } | undefined,
  steps: readonly (() => unknown | Promise<unknown>)[],
  report: (error: unknown) => void = (error) =>
    console.error('Secondary quote control cleanup failure', error)
) {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  const secondary = primary ? failures : failures.slice(1);
  for (const error of secondary) {
    try {
      report(error);
    } catch {
      // Reporting has no authority to replace an earlier test/cleanup cause.
    }
  }
  if (primary) throw primary.error;
  if (failures.length) throw failures[0];
}
