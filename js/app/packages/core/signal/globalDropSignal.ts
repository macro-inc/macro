import { createSignal, onCleanup, onMount } from 'solid-js';

function createGlobalDropSignal(acceptedTypes: string[]) {
  const [isValidFileDragging, setIsValidFileDragging] = createSignal(false);

  const isFileTypeValid = (file: File | DataTransferItem) => {
    return acceptedTypes.some((type) => file.type.match(type));
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer && e.dataTransfer.items.length > 0) {
      const isValid = Array.from(e.dataTransfer.items).some(isFileTypeValid);
      setIsValidFileDragging(isValid);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if the mouse has left the window
    if (
      e.clientX <= 0 ||
      e.clientY <= 0 ||
      e.clientX >= window.innerWidth ||
      e.clientY >= window.innerHeight
    ) {
      setIsValidFileDragging(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsValidFileDragging(false);
  };

  onMount(() => {
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);

    onCleanup(() => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
    });
  });

  return isValidFileDragging;
}

export function useGlobalDropSignal(acceptedTypes: string[]) {
  // TODO: memoize on accepted types
  return createGlobalDropSignal(acceptedTypes);
}
