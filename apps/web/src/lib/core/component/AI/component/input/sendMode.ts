type ChatSendMode = 'foreground' | 'background';

export function getSendModeFromEnterKeyEvent(event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): ChatSendMode {
  return event.shiftKey && (event.metaKey || event.ctrlKey)
    ? 'background'
    : 'foreground';
}

export function shouldOpenChatSplit(sendMode?: ChatSendMode): boolean {
  return sendMode !== 'background';
}
