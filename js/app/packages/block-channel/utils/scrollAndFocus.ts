import type { VirtualizerHandle } from 'virtua/solid';

export const scrollIntoViewAndFocus = ({
  virtualHandle,
  container,
  targetIndex,
  targetId,
}: {
  virtualHandle: VirtualizerHandle;
  container: HTMLElement | undefined;
  targetIndex: number;
  targetId: string;
}) => {
  virtualHandle.scrollToIndex(targetIndex);
  const targetEl = container?.querySelector<HTMLElement>(
    `[data-message-body-id="${targetId}"]`
  );
  if (targetEl) {
    requestAnimationFrame(() => {
      targetEl.focus();
    });
  }
};
