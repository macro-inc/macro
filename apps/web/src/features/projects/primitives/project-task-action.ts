/** Wait until the project summary has scrolled away and tasks own the viewport. */
export function showProjectTaskAction(
  scrollTop: number,
  summaryHeight: number
) {
  return summaryHeight > 0 && scrollTop >= summaryHeight;
}

/** Keep an inline menu when scrolling cannot put tasks alone in the viewport. */
export function showInlineProjectTaskAction(
  taskAreaHeight: number,
  viewportHeight: number
) {
  return taskAreaHeight > 0 && taskAreaHeight < viewportHeight;
}
