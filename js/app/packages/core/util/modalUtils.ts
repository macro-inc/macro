/**
 * Modal positioning and viewport constraint utilities
 */

export type ModalPosition = {
  top: number;
  left: number;
};

/**
 * Constrains a modal position to stay within viewport bounds
 * @param position The desired position
 * @param modalWidth Width of the modal
 * @param modalHeight Height of the modal
 * @param margin Minimum margin from viewport edges (default: 16px)
 * @returns Constrained position that fits within viewport
 */
export const constrainModalToViewport = (
  position: { top: number; left: number },
  modalWidth: number,
  modalHeight: number,
  margin: number = 16
): { top: number; left: number } => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let { top, left } = position;

  // Constrain horizontally
  if (left + modalWidth > viewportWidth - margin) {
    left = viewportWidth - modalWidth - margin;
  }
  if (left < margin) {
    left = margin;
  }

  // Constrain vertically
  if (top + modalHeight > viewportHeight - margin) {
    top = viewportHeight - modalHeight - margin;
  }
  if (top < margin) {
    top = margin;
  }

  return { top: Math.max(margin, top), left: Math.max(margin, left) };
};

/**
 * Calculates optimal modal position relative to a trigger element
 * @param triggerElement The element that triggered the modal
 * @param modalWidth Width of the modal
 * @param modalHeight Height of the modal
 * @param margin Minimum margin from viewport edges
 * @returns Optimal position that avoids going off-screen
 */
export const calculateModalPosition = (
  triggerElement: HTMLElement,
  modalWidth: number,
  modalHeight: number,
  margin: number = 16
): ModalPosition => {
  const triggerRect = triggerElement.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Position to the left of the trigger button by default
  let left = triggerRect.left - modalWidth - 8; // 8px gap to the left of trigger
  let top = triggerRect.top;

  // If positioning to the left would go off-screen, try positioning to the right
  if (left < margin) {
    left = triggerRect.right + 8; // 8px gap to the right of trigger
  }

  // If positioning to the right would still go off-screen, center horizontally
  if (left + modalWidth > viewportWidth - margin) {
    left = Math.max(margin, (viewportWidth - modalWidth) / 2);
  }

  // Adjust vertical position if modal would go off-screen
  if (top + modalHeight > viewportHeight - margin) {
    // Try positioning above the trigger element
    top = triggerRect.top - modalHeight - 8;

    // If that would go off-screen at the top, position at the bottom with margin
    if (top < margin) {
      top = viewportHeight - modalHeight - margin;
    }
  }

  // Use constraint utility for final bounds check
  return constrainModalToViewport(
    { top, left },
    modalWidth,
    modalHeight,
    margin
  );
};

/**
 * CSS utility classes for ensuring modals stay within viewport
 */
export const MODAL_VIEWPORT_CLASSES =
  'min-h-0 min-w-0 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]';

/**
 * Creates a window resize handler that repositions a modal element
 * @param modalElement The modal DOM element
 * @param originalPosition The original calculated position
 * @param modalWidth Width of the modal
 * @param modalHeight Height of the modal
 * @returns Cleanup function to remove the resize listener
 */
export const createModalResizeHandler = (
  modalElement: HTMLElement,
  originalPosition: { top: number; left: number },
  modalWidth: number,
  modalHeight: number
): (() => void) => {
  const handleResize = () => {
    const constrainedPosition = constrainModalToViewport(
      originalPosition,
      modalWidth,
      modalHeight
    );

    modalElement.style.top = `${constrainedPosition.top}px`;
    modalElement.style.left = `${constrainedPosition.left}px`;
  };

  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
};
