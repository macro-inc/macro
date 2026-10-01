export type CompanyImportRow = { name: string; domain: string };
export function normalizeCompanyImport(
  records: readonly Record<string, string>[]
):
  | { rows: CompanyImportRow[]; error?: never }
  | { error: string; rows?: never } {
  const normalized = records.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.toLowerCase(),
        value.trim(),
      ])
    )
  );
  if (
    !normalized.length ||
    normalized.length > 100 ||
    normalized.some(
      (row) =>
        !row.name ||
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(
          row.domain ?? ''
        )
    )
  ) {
    return {
      error:
        'Use name and domain columns, with 1–100 companies and domains like acme.com.',
    };
  }
  return {
    rows: normalized.map((row) => ({
      name: row.name,
      domain: row.domain.toLowerCase(),
    })),
  };
}
