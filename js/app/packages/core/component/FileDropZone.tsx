import {
  type ComponentProps,
  createSignal,
  type JSX,
  splitProps,
} from 'solid-js';

type FileDropZoneProps = ComponentProps<'div'> & {
  acceptedMimeTypes: string[];
  acceptedExtensions: string[];
  onFilesDrop: (files: File[]) => void;
  disableClick?: boolean;
};

export function FileDropZone(props_: FileDropZoneProps) {
  const [props, rest] = splitProps(props_, [
    'acceptedMimeTypes',
    'acceptedExtensions',
    'onFilesDrop',
    'children',
    'disableClick',
  ]);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isValidDrop, setIsValidDrop] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  const isFileTypeValid = (file: File) => {
    // check mimeType
    if (file.type && props.acceptedMimeTypes.includes(file.type)) {
      return true;
    }

    // check extension
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension && props.acceptedExtensions.includes(extension)) {
      return true;
    }
    return false;
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);

    if (e.dataTransfer) {
      const isValid = Array.from(e.dataTransfer.items).every((item) =>
        isFileTypeValid({ type: item.type } as File)
      );
      setIsValidDrop(isValid);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer?.files || []);
    const validFiles = files.filter(isFileTypeValid);

    if (validFiles.length > 0) {
      props.onFilesDrop(validFiles);
    }
  };

  const handleFileInputChange: JSX.ChangeEventHandlerUnion<
    HTMLInputElement,
    Event
  > = (e) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(isFileTypeValid);

    if (validFiles.length > 0) {
      props.onFilesDrop(validFiles);
    }
  };

  const handleMouseDown = () => {
    if (props.disableClick || !inputRef) return;

    inputRef.click();
  };

  return (
    <div
      {...rest}
      data-drop-valid={isDragging() && isValidDrop() ? true : undefined}
      data-drop-invalid={isDragging() && !isValidDrop() ? true : undefined}
      onmousedown={handleMouseDown}
      on:dragenter={handleDragEnter}
      on:dragleave={handleDragLeave}
      on:dragover={handleDragOver}
      on:drop={handleDrop}
    >
      <input
        type="file"
        ref={inputRef}
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
        accept={
          props.acceptedMimeTypes.join(',') +
          ',.' +
          props.acceptedExtensions.join(',.')
        }
        multiple
      />
      {props.children}
    </div>
  );
}
