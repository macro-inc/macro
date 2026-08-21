import { type Accessor, onCleanup } from 'solid-js';

interface FolderSelectorProps {
  onSelect: (files: File[]) => void;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      folderSelector: FolderSelectorProps | undefined;
    }
  }
}

export function folderSelector(
  element: HTMLElement,
  accessor: Accessor<FolderSelectorProps | undefined>
) {
  const handleFolderInputChange = () => {
    const files = Array.from(input.files || []).filter(
      (file) => !file.name.startsWith('.')
    );
    accessor()?.onSelect?.(files);
  };

  let input = document.createElement('input');
  input.type = 'file';
  input.style.display = 'none';
  input.webkitdirectory = true;

  const clickInput = (e: MouseEvent) => {
    e.stopPropagation();
    input.click();
  };

  input.addEventListener('change', handleFolderInputChange);
  element.addEventListener('click', clickInput);

  onCleanup(() => {
    input.removeEventListener('change', handleFolderInputChange);
    element.removeEventListener('click', clickInput);
  });
}
