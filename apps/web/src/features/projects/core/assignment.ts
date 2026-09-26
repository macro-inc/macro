export type ProjectAssignmentResult = { taskId: string; error?: string };

export type ProjectAssignmentPort = {
  assign(
    projectId: string,
    taskIds: string[]
  ): Promise<ProjectAssignmentResult[]>;
  clear(taskId: string): Promise<void>;
};

/** Keep successes when another batch fails so the picker retries only unfinished tasks. */
export async function assignProjectTasks(
  port: ProjectAssignmentPort,
  projectId: string | undefined,
  taskIds: readonly string[]
): Promise<ProjectAssignmentResult[]> {
  const results: ProjectAssignmentResult[] = [];
  const unique = [...new Set(taskIds)];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    if (projectId) {
      try {
        results.push(...(await port.assign(projectId, batch)));
      } catch {
        results.push(
          ...batch.map((taskId) => ({
            taskId,
            error: 'Could not set the project. Retry this task.',
          }))
        );
      }
    } else {
      const removed = await Promise.allSettled(
        batch.map((taskId) => port.clear(taskId))
      );
      results.push(
        ...removed.map((result, index) => ({
          taskId: batch[index],
          error:
            result.status === 'rejected'
              ? 'Could not remove this task from its project.'
              : undefined,
        }))
      );
    }
  }
  return results;
}
