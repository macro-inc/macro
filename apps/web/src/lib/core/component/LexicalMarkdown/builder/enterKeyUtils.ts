export function shouldInsertNewlineOnEnter(event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return event.shiftKey && !event.metaKey && !event.ctrlKey;
}
