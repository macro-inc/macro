export function isDatabaseNameTaken(
  name: string,
  names: readonly string[]
): boolean {
  const candidate = name.trim().toLocaleLowerCase();
  return names.some(
    (existing) => existing.trim().toLocaleLowerCase() === candidate
  );
}

export function defaultDatabaseColumnName(names: readonly string[]): string {
  let name = 'Unnamed';
  let suffix = 2;
  while (isDatabaseNameTaken(name, names)) name = `Unnamed ${suffix++}`;
  return name;
}

export function defaultFormulaColumnName(names: readonly string[]): string {
  let name = 'Formula';
  let suffix = 2;
  while (isDatabaseNameTaken(name, names)) name = `Formula ${suffix++}`;
  return name;
}
