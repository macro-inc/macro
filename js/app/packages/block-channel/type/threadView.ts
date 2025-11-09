export type ThreadView = {
  threadExpanded: boolean;
  hasActiveReply: boolean;
  replyInputMountTarget?: HTMLElement | undefined;
  replyInputShouldFocus?: boolean;
};

export type ThreadViewData = Record<string, ThreadView>;
