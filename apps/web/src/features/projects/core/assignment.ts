export type ProjectAssignmentResult = { taskId: string; error?: string };

const CONCURRENT_SAVES = 25;

/**
 * Sets each task's Project independently, so a failure keeps the other tasks'
 * changes and the picker retries only the unfinished tasks.
 */
export async function assignProjectTasks(
  setProject: (taskId: string, projectId: string | undefined) => Promise<void>,
  projectId: string | undefined,
  taskIds: readonly string[]
): Promise<ProjectAssignmentResult[]> {
  const results: ProjectAssignmentResult[] = [];
  const unique = [...new Set(taskIds)];
  for (let offset = 0; offset < unique.length; offset += CONCURRENT_SAVES) {
    const batch = unique.slice(offset, offset + CONCURRENT_SAVES);
    const saved = await Promise.allSettled(
      batch.map((taskId) => setProject(taskId, projectId))
    );
    results.push(
      ...saved.map((result, index) => ({
        taskId: batch[index],
        error:
          result.status === 'fulfilled'
            ? undefined
            : projectId
              ? 'Could not set the project. You need edit access to the task and the project.'
              : 'Could not remove this task from its project.',
      }))
    );
  }
  return results;
}
