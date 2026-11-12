export type SearchPage = {
  href: string;
  title: string;
  context: string;
  iconHref?: string;
  text: string;
};

function words(value: string): string[] {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

// Same one-edit tolerance as the app's Settings search, without its app imports.
function nearWord(a: string, b: string): boolean {
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] &&
        a[i + 1] === b[i] &&
        a.slice(i + 2) === b.slice(i + 2))
    );
  }
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

function matchWord(query: string, candidate: string, fuzzy: boolean): number {
  if (query === candidate) return 12;
  if (candidate.startsWith(query)) return 9;
  if (query.length >= 3 && candidate.includes(query)) return 6;
  return fuzzy && nearWord(query, candidate) ? 4 : 0;
}

export function createPageSearch(pages: readonly SearchPage[]) {
  const index = pages.map((page) => ({
    page,
    title: words(page.title),
    context: words(page.context),
    text: [...new Set(words(page.text))],
  }));
  return (query: string): SearchPage[] => {
    const tokens = words(query);
    if (!tokens.length) return [];
    return index
      .map(({ page, title, context, text }) => {
        const scores = tokens.map((token) =>
          Math.max(
            0,
            ...title.map((word) => matchWord(token, word, true) * 4),
            ...context.map((word) => matchWord(token, word, false) * 2),
            ...text.map((word) => matchWord(token, word, false))
          )
        );
        return {
          page,
          score: scores.every(Boolean) ? scores.reduce((a, b) => a + b, 0) : 0,
        };
      })
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title)
      )
      .slice(0, 8)
      .map(({ page }) => page);
  };
}
