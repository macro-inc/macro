/** Wait until the project summary has scrolled away and tasks own the viewport. */
export function showProjectTaskAction(
  scrollTop: number,
  summaryHeight: number
) {
  return summaryHeight > 0 && scrollTop >= summaryHeight;
}
