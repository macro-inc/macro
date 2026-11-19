undef $/; $_=<STDIN>;
s/type QueryLike = \{ readonly isPending: boolean; readonly data: unknown \};/type QueryLike = {\n  readonly isPending: boolean;\n  readonly isLoadingError?: boolean;\n  readonly data: unknown;\n};/ or die 1;
s/  return !query\.isPending && query\.data !== undefined;/  \/\/ A query that failed before it had data has none to read, and reading it\n  \/\/ suspends again each time the query takes new options.\n  if (query.isPending || query.isLoadingError) return false;\n  return query.data !== undefined;/ or die 2;
print;
