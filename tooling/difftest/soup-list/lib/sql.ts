/**
 * Direct SQL on the local stack's Postgres, for state no local API creates
 * (GitHub pull requests synced from GitHub) and for exact ties in timestamps.
 * Synthetic rows only; the instance is a throwaway local stack.
 */
export function sqlContainer(instance: string) {
  return `macro-${instance}-postgres-1`;
}

export async function sql(instance: string, query: string): Promise<string[]> {
  const proc = Bun.spawn(
    [
      'docker',
      'exec',
      '-i',
      sqlContainer(instance),
      'psql',
      '-U',
      'user',
      '-d',
      'macrodb',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atq',
    ],
    { stdin: new TextEncoder().encode(query), stdout: 'pipe', stderr: 'pipe' }
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`sql failed (${code}): ${err.slice(0, 500)}`);
  return out.split('\n').filter((line) => line.length > 0);
}

/** A SQL string literal. */
export function lit(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  return `'${value.replaceAll("'", "''")}'`;
}
