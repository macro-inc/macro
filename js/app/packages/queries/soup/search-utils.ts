/** Helper function to build search terms from a query string. Terms are split by whitespace. Quoted terms are kept as is */
export const buildSearchTerms = (query: string): string[] => {
  const matches = query.trim().match(/"[^"]*"|\S+/g);
  if (!matches) return [''];
  return matches.map((term) => {
    if (term.startsWith('"') && term.endsWith('"')) {
      return term.slice(1, -1);
    }
    return term;
  });
};
