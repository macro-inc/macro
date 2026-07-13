type ComputeVisiblePillValuesInput<T extends string> = {
  values: readonly T[];
  activeValue: T | undefined;
  currentVisibleValues: readonly T[];
  widths: readonly number[];
  availableWidth: number;
  gap: number;
  overflowWidth: number;
};

const totalWidth = (
  indexes: number[],
  widths: readonly number[],
  gap: number
) =>
  indexes.reduce((total, index) => total + widths[index], 0) +
  gap * Math.max(0, indexes.length - 1);

const totalWidthWithOverflow = (
  indexes: number[],
  widths: readonly number[],
  gap: number,
  overflowWidth: number
) =>
  indexes.reduce((total, index) => total + widths[index], 0) +
  overflowWidth +
  gap * indexes.length;

export function computeVisiblePillValues<T extends string>({
  values,
  activeValue,
  currentVisibleValues,
  widths,
  availableWidth,
  gap,
  overflowWidth,
}: ComputeVisiblePillValuesInput<T>): T[] {
  const allIndexes = values.map((_, index) => index);

  if (values.length === 0) return [];

  if (totalWidth(allIndexes, widths, gap) <= availableWidth) {
    return [...values];
  }

  const activeIndex =
    activeValue === undefined ? -1 : values.indexOf(activeValue);
  const valueToIndex = new Map(values.map((value, index) => [value, index]));
  const currentIndexes = currentVisibleValues.flatMap((value) => {
    const index = valueToIndex.get(value);
    return index === undefined ? [] : [index];
  });
  const fitsWithOverflow = (indexes: number[]) =>
    totalWidthWithOverflow(indexes, widths, gap, overflowWidth) <=
    availableWidth;

  const packIndexes = (orderedIndexes: number[]) => {
    const packed: number[] = [];
    for (const index of orderedIndexes) {
      const candidate = [...packed, index];
      if (fitsWithOverflow(candidate)) {
        packed.push(index);
      }
    }
    return packed;
  };

  const packIndexesEndingWith = (
    lastIndex: number,
    orderedIndexes: number[]
  ) => {
    const packed: number[] = [];
    for (const index of orderedIndexes) {
      if (index === lastIndex) continue;
      const candidate = [...packed, index, lastIndex];
      if (fitsWithOverflow(candidate)) {
        packed.push(index);
      }
    }
    return [...packed, lastIndex];
  };

  const trimIndexesKeepingActive = (indexes: number[], keepIndex: number) => {
    const trimmed = [...indexes];
    while (trimmed.length > 1 && !fitsWithOverflow(trimmed)) {
      const removeIndex = trimmed.findLastIndex((index) => index !== keepIndex);
      if (removeIndex === -1) break;
      trimmed.splice(removeIndex, 1);
    }
    return trimmed;
  };

  const fillIndexes = (baseIndexes: number[], orderedIndexes: number[]) => {
    const filled = [...baseIndexes];
    for (const index of orderedIndexes) {
      if (filled.includes(index)) continue;
      const candidate = [...filled, index];
      if (fitsWithOverflow(candidate)) {
        filled.push(index);
      }
    }
    return filled;
  };

  const naturalVisibleIndexes = packIndexes(allIndexes);
  const activeIsCurrentlyVisible =
    activeIndex !== -1 && currentIndexes.includes(activeIndex);
  const visibleIndexes = activeIsCurrentlyVisible
    ? fillIndexes(
        trimIndexesKeepingActive(currentIndexes, activeIndex),
        allIndexes
      )
    : activeIndex !== -1 && !naturalVisibleIndexes.includes(activeIndex)
      ? packIndexesEndingWith(activeIndex, allIndexes)
      : naturalVisibleIndexes;

  return visibleIndexes.map((index) => values[index]);
}
