const DAY_MILLISECONDS = 86_400_000;
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * A typed number, percentage, currency amount, date (ISO or month/day/year)
 * or time as Excel's value.
 */
export function typedNumber(input: string): number | undefined {
  const text = input.trim().replace(/^\+/, '');
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
    return Number(text);
  let match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))%$/.exec(text);
  if (match) return Number(match[1]) / 100;
  match = /^(-?)[$€£]?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/.exec(text);
  if (match)
    return Number(`${match[1]}${match[2].replace(/,/g, '')}${match[3] ?? ''}`);
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match)
    return (
      (Date.UTC(+match[1], +match[2] - 1, +match[3]) - SERIAL_EPOCH) /
      DAY_MILLISECONDS
    );
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (match) {
    const year = +match[3] < 100 ? 2000 + +match[3] : +match[3];
    return (
      (Date.UTC(year, +match[1] - 1, +match[2]) - SERIAL_EPOCH) /
      DAY_MILLISECONDS
    );
  }
  match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (match)
    return (+match[1] * 3600 + +match[2] * 60 + +(match[3] ?? 0)) / 86_400;
}
