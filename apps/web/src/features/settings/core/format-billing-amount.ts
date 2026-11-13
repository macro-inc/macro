/** Format the provider's minor-unit amounts, including its ISK/UGX wire exceptions. */
export function formatBillingAmount(
  amount: number,
  currency: string,
  locale?: string
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  });
  const options = formatter.resolvedOptions();
  const digits =
    options.currency === 'ISK' || options.currency === 'UGX'
      ? 2
      : (options.maximumFractionDigits ?? 2);
  return formatter.format(amount / 10 ** digits);
}
