/**
 * TODO (seamus): Stashing this to return to. Not sure if
 * this will be worth the effort.
 */
function matchCaret(caretElement: HTMLDivElement, selection: Selection | null) {
  // If no selection or multiple ranges, hide cursor
  if (selection === null || selection.rangeCount === 0) {
    caretElement.style.visibility = 'hidden';
    return;
  }

  const range = selection.getRangeAt(0);

  // Hide caret if selection is not collapsed (i.e., text is selected)
  if (!range.collapsed) {
    caretElement.style.visibility = 'hidden';
    return;
  }

  // Make caret visible
  caretElement.style.visibility = 'visible';

  // Get bounding rectangle of the range
  const rect = range.getBoundingClientRect();

  // Update caret position and size
  caretElement.style.height = `${rect.height}px`;
  caretElement.style.left = `${rect.left - 1}px`;
  caretElement.style.top = `${rect.top}px`;
}

export function customCursorPlugin() {
  return () => {
    const caretElement = document.createElement('div');
    caretElement.className = 'fixed w-[2px] h-[10px] bg-accent';
    caretElement.style.top = '0px';
    caretElement.style.visibility = 'hidden';
    document.body.append(caretElement);

    // Handle selection changes
    const handleSelectionChange = () => {
      matchCaret(caretElement, window.getSelection());
    };

    // Handle scroll events
    const handleScroll = () => {
      matchCaret(caretElement, window.getSelection());
    };

    // Add event listeners
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('scroll', handleScroll);

    // Return cleanup function
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('scroll', handleScroll);
      caretElement.remove();
    };
  };
}
