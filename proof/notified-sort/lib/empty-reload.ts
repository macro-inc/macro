// Which reload checks of a step read nothing on the branch while the same list
// read on its own page and the reloaded document's other lists matched main
// (closure R2; report.ts reclassifyEmptyReloads).

const HARD = /(^|\s)(membership|order|error)[:\s]|(^|\s)(membership|order|error)$/;

export type EmptyReload = { spec: number; missing: string[]; qualifies: boolean };

/**
 * For each reload check of a step that has `missing-in-new` rows: whether
 * that was all it had (the branch's read had none of main's rows and nothing
 * else), the raw read of the same list in the step had no membership, order
 * or error difference, and neither had any other reload check of the step.
 */
export function emptyReloads(checks: Record<string, unknown>): EmptyReload[] {
  const reloads = Object.keys(checks).filter((k) => /^reload\d+$/.test(k) && Array.isArray(checks[k]));
  return reloads.flatMap((key) => {
    const spec = Number(key.slice('reload'.length));
    const own = (checks[key] as string[]).filter((c) => !c.startsWith('same-instant:'));
    const missing = own.filter((c) => new RegExp(`^reload spec${spec} membership:missing-in-new:\\w+$`).test(c));
    if (!missing.length) return [];
    const raw = checks[`raw${spec}`] as { classes?: string[] } | undefined;
    const qualifies =
      missing.length === own.length &&
      !!raw &&
      !(raw.classes ?? []).some((c) => HARD.test(c)) &&
      reloads.filter((k) => k !== key).every((k) => !(checks[k] as string[]).some((c) => HARD.test(c)));
    return [{ spec, missing, qualifies }];
  });
}
