export function containsAllSameValues(a: unknown[], b: unknown[]) {
  if (a.length !== b.length) return false;
  return (
    a.every((value) => b.includes(value)) &&
    b.every((value) => a.includes(value))
  );
}

export function containsAllSameOrderedValues(a: unknown[], b: unknown[]) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}
