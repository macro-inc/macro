export type TDestArray = [
  { num: number; gen: number } | null,
  {
    name: 'XYZ' | 'Fit' | 'FitB' | 'FitH' | 'FitBH' | 'FitV' | 'FitBV' | 'FitR';
  },
  number | null,
  number | null,
  number | null,
  number | null,
];

export function destHrefToDest(href: string): string | TDestArray | null {
  const hash = href.split('#');
  if (hash.length !== 2) return null;

  const decoded = decodeURIComponent(hash[1]);

  // possibly JSON array
  if (
    decoded.length > 1 &&
    decoded[0] === '[' &&
    decoded[decoded.length - 1] === ']'
  ) {
    try {
      return JSON.parse(decoded) as TDestArray;
    } catch {
      console.error(
        'failed parsing an internal link destination as TDestArray'
      );
    }
  }

  return decoded;
}
