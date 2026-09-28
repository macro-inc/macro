/** CSV has no type metadata. Preserve identifiers and formula-looking text. */
export function csvCellValue(value: string): string {
  if (!value) return '';
  const numeric =
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) &&
    Number.isFinite(Number(value)) &&
    value.replace(/[^\d]/g, '').length <= 15;
  return numeric ? value : `'${value}`;
}
