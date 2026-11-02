/** JSON encoding for the PDF protocol; independent of its validators. */
export const modificationDataReplacer = (key: string, value: any) => {
  if (key === 'pageRange') {
    return Array.from(value);
  }

  if (typeof value === 'number' && !Number.isInteger(value)) {
    return parseFloat(value.toFixed(12));
  }

  return value;
};
