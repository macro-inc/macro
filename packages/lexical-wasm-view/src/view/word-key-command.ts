/** Source Control-or-Meta word/line-edge command selection, not node policy. */
const apple =
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export function wordKeyCommand(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'
  >
): 'Key(MoveToStart)' | 'Key(MoveToEnd)' | undefined {
  if (
    event.altKey ||
    event.isComposing ||
    event.ctrlKey !== !apple ||
    event.metaKey !== apple
  )
    return undefined;
  if (event.key === 'ArrowLeft') return 'Key(MoveToStart)';
  if (event.key === 'ArrowRight') return 'Key(MoveToEnd)';
  return undefined;
}
