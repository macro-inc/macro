export function isEditableInput(target: Element | undefined | null) {
  if (!target) return false;
  // Check if target is an input
  if (target instanceof HTMLInputElement) {
    // Exclude checkbox and radio which aren't text-editable
    return !['checkbox', 'radio', 'submit', 'reset', 'button'].includes(
      target.type
    );
  }
  // Check if target is a textarea
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }
  // Check for contenteditable elements
  if (
    target.hasAttribute('contenteditable') &&
    target.getAttribute('contenteditable') !== 'false'
  ) {
    return true;
  }

  // Fix for Code Block
  if (
    target.hasAttribute('role') &&
    target.getAttribute('role') === 'textbox'
  ) {
    return true;
  }

  // Handle canvas
  // if (target.hasAttribute('data-visual-editor')) {
  //   return true;
  // }
}
