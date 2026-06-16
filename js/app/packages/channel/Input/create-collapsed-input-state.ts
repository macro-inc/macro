import { isMobile } from '@core/mobile/isMobile';
import { pickNativePhotoLibraryMedia } from '@core/mobile/nativePhotoLibrary';
import { isPlatform } from '@core/util/platform';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';

/**
 * State and handlers for the `CollapsedInput` that stands in for a full
 * input until the user expands it.
 */
export function createCollapsedInputState(options: {
  /** Id of the input this state serves; collapses again when it changes. */
  inputId: Accessor<string | undefined>;
  attachFiles: (files: File[]) => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = createSignal(false);
  let filePickerRef: HTMLInputElement | undefined;

  // Collapse again when the surrounding view switches to another input.
  createEffect(
    on(options.inputId, () => setIsExpanded(false), { defer: true })
  );

  const attachFiles = async (files: File[]) => {
    if (files.length === 0) return;
    await options.attachFiles(files);
  };

  const attach = () => {
    if (isPlatform('ios')) {
      void pickNativePhotoLibraryMedia().then((files) => {
        if (files === null) {
          filePickerRef?.click();
          return;
        }
        return attachFiles(files);
      });
      return;
    }
    filePickerRef?.click();
  };

  const onFilePickerChange = (
    event: Event & { currentTarget: HTMLInputElement }
  ) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    void attachFiles(files);
  };

  return {
    /** Whether the collapsed stand-in renders instead of the real input. */
    isCollapsed: () => isMobile() && !isExpanded(),
    expand: () => setIsExpanded(true),
    collapse: () => setIsExpanded(false),
    attach,
    onFilePickerChange,
    setFilePickerRef: (element: HTMLInputElement) => {
      filePickerRef = element;
    },
  };
}
