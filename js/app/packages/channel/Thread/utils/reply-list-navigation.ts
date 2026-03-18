export function getReplyElementAtIndex(
  elements: Array<HTMLElement | undefined>,
  index: number
): HTMLElement | undefined {
  if (index < 0) return undefined;
  return elements[index];
}
