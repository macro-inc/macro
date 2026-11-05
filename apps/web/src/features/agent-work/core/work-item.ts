/** How a registered session reads in Work. */
export type WorkItemState = 'running' | 'needs_input' | 'failed' | 'idle';

/** A session an account registered as its work. */
export type WorkItem = {
  id: string;
  title: string;
  state: WorkItemState;
  pullRequestNumber?: number;
};
