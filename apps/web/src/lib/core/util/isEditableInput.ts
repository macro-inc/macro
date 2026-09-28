export function isEditableInput(target: Element | undefined | null) {
  if (!target) return false;
  // Composite editors (such as a spreadsheet grid between cell edits) own
  // typing/navigation even though they are not native text inputs.
  if (target.hasAttribute('data-keyboard-input')) return true;
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
