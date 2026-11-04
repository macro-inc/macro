/** Reserve the card before fetching its form; old cards have no layout hint. */
export function pollCardHeight(previewData: unknown): string | undefined {
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
  // The card with a one-line question at the default font size: header and
  // footer plus 44px choices and 8px gaps. Wrapped text grows the card.
  return `${10.5 + count * 3.25}rem`;
}
