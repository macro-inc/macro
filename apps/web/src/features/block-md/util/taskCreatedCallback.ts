/** A failed post-create action must not strand a task that was already saved. */
export async function runTaskCreatedCallback<T>(
  callback: ((created: T) => Promise<void> | void) | undefined,
  created: T,
  reportFailure: (message: string) => void
): Promise<void> {
  try {
    await callback?.(created);
  } catch {
    reportFailure(
      'Task created, but a follow-up action failed. Open the task to finish updating it.'
    );
  }
}
