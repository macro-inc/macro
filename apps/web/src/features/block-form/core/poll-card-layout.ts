/**
 * The height of a poll card's body (its "Poll" row, 44px choices with 8px
 * gaps, and the votes footer), reserved before its form loads. Choices are one
 * line, so only the option count matters; the question wraps in the card's
 * header, which renders its text while loading. Old cards have no layout hint.
 */
export function pollBodyHeight(previewData: unknown): string | undefined {
  if (
    !previewData ||
    typeof previewData !== 'object' ||
    !('poll' in previewData)
  )
    return;
  const poll = previewData.poll;
  if (!poll || typeof poll !== 'object' || !('optionCount' in poll)) return;
  const count = poll.optionCount;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 2 ||
    count > 20
  )
    return;
  return `${6.625 + count * 3.25}rem`;
}
