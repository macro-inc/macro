export const URL_PARAMS = {
  /**
   * Document id of the task this PR was opened from. When present, PR data
   * loads from the task's stored GitHub data (team-visible, populated by the
   * GitHub App installation) instead of requiring a personal GitHub link.
   */
  task: 'task',
} as const;
