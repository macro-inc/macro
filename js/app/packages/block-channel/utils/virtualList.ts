export function shouldResetVirtualList(
  prevIds: readonly string[],
  nextIds: readonly string[]
): boolean {
  if (prevIds.length === 0 || nextIds.length === 0) return false;

  if (prevIds.length === nextIds.length) {
    return false;
  }

  if (nextIds.length > prevIds.length) {
    const isAppend = prevIds.every((id, index) => id === nextIds[index]);
    if (isAppend) return false;

    const offset = nextIds.length - prevIds.length;
    const isPrepend = prevIds.every(
      (id, index) => id === nextIds[index + offset]
    );
    return !isPrepend;
  }

  const isRemoveFromEnd = nextIds.every((id, index) => id === prevIds[index]);
  if (isRemoveFromEnd) return false;

  const offset = prevIds.length - nextIds.length;
  const isRemoveFromStart = nextIds.every(
    (id, index) => id === prevIds[index + offset]
  );
  return !isRemoveFromStart;
}
