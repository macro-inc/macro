import type { ProjectAssignmentResult } from '../core/assignment';

/** Associate every creation mode without changing Continue in split navigation. */
export function createProjectTaskComposerCallbacks(capabilities: {
  projectId: string;
  assignTasks(
    projectId: string,
    taskIds: readonly string[]
  ): Promise<ProjectAssignmentResult[]>;
  openProjectTasks(): void;
  reportFailure(message: string): void;
}) {
  return {
    onTaskCreated: async ({ documentId }: { documentId: string }) => {
      try {
        const results = await capabilities.assignTasks(capabilities.projectId, [
          documentId,
        ]);
        const failed = results.find((result) => result.error);
        if (failed) capabilities.reportFailure(`Task created. ${failed.error}`);
      } catch {
        capabilities.reportFailure(
          'Task created, but could not be added to the project. Add it from the project Tasks tab.'
        );
      }
    },
    onSuccess: capabilities.openProjectTasks,
  };
}
