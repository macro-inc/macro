/**
 * `order` with `id` moved to just before or after `targetId`; undefined
 * when either is missing or they are the same.
 */
export function moveBeside(
  order: readonly string[],
  id: string,
  targetId: string,
  edge: 'before' | 'after'
): string[] | undefined {
  if (id === targetId || !order.includes(id) || !order.includes(targetId))
    return undefined;
  const moved = order.filter((entry) => entry !== id);
  moved.splice(moved.indexOf(targetId) + (edge === 'after' ? 1 : 0), 0, id);
  return moved;
}
