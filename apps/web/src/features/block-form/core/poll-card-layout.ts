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
  // Fixed header/footer space plus 44px choices and 8px gaps at the default
  // font size. Large polls scroll inside their card instead of moving chat.
  return `${Math.min(11.75 + count * 3.25, 40)}rem`;
}
